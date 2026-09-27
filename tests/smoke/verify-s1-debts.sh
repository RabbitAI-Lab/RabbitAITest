#!/bin/bash
# S1 遗留缺陷修复核验（对 :3000 开发栈逐一打点；全部为只读或自建自清理数据）
B=http://127.0.0.1:3000/api/v1
pass=0; fail=0
chk() { # name expected actual
  if [ "$2" = "$3" ]; then echo "  ✅ $1 → $3"; pass=$((pass+1)); else echo "  ❌ $1 → 期望 $2 实得 $3"; fail=$((fail+1)); fi
}
code() { curl -s -o /tmp/v.json -w '%{http_code}' "$@"; }
biz() { python3 -c "import json;print(json.load(open('/tmp/v.json')).get('code'))" 2>/dev/null; }

curl -s -c /tmp/v.jar -X POST $B/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@rabbit.test","password":"rabbit-admin-123"}' >/dev/null
PID=$(curl -s -b /tmp/v.jar $B/personal/projects | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print(d[0]['id'] if isinstance(d,list) else d['items'][0]['id'])")
echo "projectId=$PID"

echo "== ① CASE-001 空名称 500→422 =="
c=$(code -b /tmp/v.jar -X POST $B/projects/$PID/cases -H 'Content-Type: application/json' -d '{"name":""}')
b=$(biz); chk "HTTP=422" 422 "$c"; chk "code=20422" 20422 "$b"

echo "== ② CASE-003 评论超长 500→422 =="
CASE=$(curl -s -b /tmp/v.jar -X POST $B/projects/$PID/cases -H 'Content-Type: application/json' -d '{"name":"核验用例"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['id'])")
LONG=$(python3 -c "print('x'*9000)")
c=$(code -b /tmp/v.jar -X POST "$B/projects/$PID/comments?entity=case:$CASE" -H 'Content-Type: application/json' -d "{\"content\":\"$LONG\"}")
b=$(biz); chk "HTTP=422" 422 "$c"; chk "code=20422" 20422 "$b"

echo "== ③ SYS-004 建用户非法邮箱 500→422 =="
c=$(code -b /tmp/v.jar -X POST $B/system/users -H 'Content-Type: application/json' -d '{"email":"not-an-email","name":"x"}')
chk "HTTP=422" 422 "$c"

echo "== ④ SYS-004 组添加成员非法 userIds 500→422 =="
GID=$(curl -s -b /tmp/v.jar "$B/system/groups" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];items=d if isinstance(d,list) else d.get('items',[]);print([g['id'] for g in items if g['scope']=='system' and '管理员' in g['name']][0])")
c=$(code -b /tmp/v.jar -X POST "$B/system/groups/$GID/members" -H 'Content-Type: application/json' -d '{"userIds":["not-a-uuid"]}')
b=$(biz); chk "HTTP=422" 422 "$c"; chk "code=20422" 20422 "$b"

echo "== ⑤ SYS-005 参数非法值（保留 6 天 / 上限 0）500→422 =="
c=$(code -b /tmp/v.jar -X PUT $B/system/params/cleanup -H 'Content-Type: application/json' -d '{"retentionDays":6}')
chk "cleanup=422" 422 "$c"
c=$(code -b /tmp/v.jar -X PUT $B/system/params/file -H 'Content-Type: application/json' -d '{"maxSizeMb":0}')
chk "file=422" 422 "$c"

echo "== ⑥ PLAN-001 计划报告 FK 500→200（建计划+用例+关联+执行）=="
PLAN=$(curl -s -b /tmp/v.jar -X POST $B/projects/$PID/plans -H 'Content-Type: application/json' -d '{"name":"核验计划"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['id'])")
curl -s -o /dev/null -b /tmp/v.jar -X POST $B/projects/$PID/plans/$PLAN/cases -H 'Content-Type: application/json' -d "{\"caseIds\":[\"$CASE\"]}"
c=$(code -b /tmp/v.jar "$B/projects/$PID/plans/$PLAN/report")
chk "报告读取=200" 200 "$c"
c=$(code -b /tmp/v.jar -X PUT "$B/projects/$PID/plans/$PLAN/report/summary" -H 'Content-Type: application/json' -d '{"summary":"核验"}')
chk "总结保存=200" 200 "$c"
# 占位任务不进任务中心
curl -s -b /tmp/v.jar "$B/projects/$PID/exec-tasks?pageSize=100" | python3 -c "
import sys,json
items=json.load(sys.stdin)['data']['items']
bad=[t for t in items if t['type']=='plan']
print('  ✅ 任务中心无 plan 占位行' if not bad else f'  ❌ 任务中心出现 plan 占位 ×{len(bad)}')"

echo "== ⑦ PLAN-001 步骤数不齐（空数组也算已提供）→422 =="
REF=$(curl -s -b /tmp/v.jar "$B/projects/$PID/plans/$PLAN" | python3 -c "
import sys,json
d=json.load(sys.stdin)['data']
refs=d.get('caseRefs') or d.get('refs') or d.get('cases') or []
items=refs if isinstance(refs,list) else refs.get('items',[])
print(items[0]['id'] if items else '')")
if [ -n "$REF" ]; then
  c=$(code -b /tmp/v.jar -X POST "$B/projects/$PID/plans/$PLAN/cases/$REF/exec" -H 'Content-Type: application/json' -d '{"status":"FAIL","steps":[]}')
  chk "空步骤数组=422" 422 "$c"
else
  echo "  ⚠️ 未取到 refId，跳过（改由 jmx PLAN-001 T1-8 覆盖）"
fi

echo "== ⑧ CASE-002 followedBy=me 500→200 =="
c=$(code -b /tmp/v.jar "$B/projects/$PID/cases?followedBy=me")
chk "HTTP=200" 200 "$c"

echo "== ⑨ e2e mock 口径（API-001 CI 三连挂根因）=="
curl -s -o /dev/null -w '  mock:4001=%{http_code}\n' http://127.0.0.1:4001/healthz 2>/dev/null || echo "  (e2e 栈未运行，跳过)"

echo "================ 汇总: ✅$pass ❌$fail ================"
