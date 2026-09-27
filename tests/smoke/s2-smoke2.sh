#!/bin/bash
# S2 冒烟第二段：mock 命中/热更新/分享/重跑/停止/变量渲染+提取写回环境
set -e
B=http://127.0.0.1:3000/api/v1
M=http://127.0.0.1:4000
PID=$1; APIID=$2; ENVID=$3
[ -z "$PID" ] && { echo "usage: $0 projectId apiId envId"; exit 1; }
curl -s -c /tmp/rabbit.jar -X POST $B/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@rabbit.test","password":"rabbit-admin-123"}' >/dev/null

echo "== 1. mock 规则（定义改 /pets/{id} 模板） =="
APIVER=$(curl -s -b /tmp/rabbit.jar $B/projects/$PID/apis/$APIID | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['version'])")
cat > /tmp/api-put.json <<JSON
{"version":$APIVER,"name":"冒烟-查询","request":{"spec":{"method":"GET","url":"/pets/{id}","headers":[],"query":[],"body":{"kind":"none"},"auth":{"kind":"none"},"timeoutMs":10000,"followRedirects":false,"skipPre":false,"skipPost":false},"asserts":[],"pre":[],"post":[],"extracts":[]},"response":{"status":200,"headers":[],"body":"{\"code\":0,\"data\":{\"kind\":\"dog\"}}"}}
JSON
curl -s -b /tmp/rabbit.jar -X PUT $B/projects/$PID/apis/$APIID -H 'Content-Type: application/json' -d @/tmp/api-put.json | head -c 120; echo
MOCK=$(curl -s -b /tmp/rabbit.jar -X POST $B/projects/$PID/apis/$APIID/mocks -H 'Content-Type: application/json' -d '{"name":"狗查询","enabled":true,"followApi":false,"matchers":{"headers":[],"query":[{"key":"kind","value":"dog"}]},"response":{"status":200,"headers":[{"key":"X-Mock","value":"1"}],"body":"{\"mock\":\"hit-dog\"}","delayMs":300}}')
echo "mock: $(echo "$MOCK" | head -c 140)"
MOCKID=$(echo "$MOCK" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['id'])")
PROJNUM=$(curl -s -b /tmp/rabbit.jar "$B/projects/$PID/apis/$APIID/mock-url" | python3 -c "import sys,json;u=json.load(sys.stdin)['data']['url'];print(u.split('/mock/')[1].split('/')[0])")
echo "projNum=$PROJNUM"
echo "-- 命中（断言延迟 ≥300ms）:"
curl -s -w "\nHTTP %{http_code} %{time_total}s\n" "$M/mock/$PROJNUM/pets/9?kind=dog"
echo "-- 未命中 kind=cat:"
curl -s -w "\nHTTP %{http_code}\n" "$M/mock/$PROJNUM/pets/9?kind=cat"
echo "-- 热更新改响应体:"
curl -s -b /tmp/rabbit.jar -X PUT $B/projects/$PID/apis/$APIID/mocks/$MOCKID -H 'Content-Type: application/json' -d '{"name":"狗查询","enabled":true,"followApi":false,"matchers":{"headers":[],"query":[{"key":"kind","value":"dog"}]},"response":{"status":200,"headers":[],"body":"{\"mock\":\"hit-v2\"}","delayMs":0}}' >/dev/null
curl -s "$M/mock/$PROJNUM/pets/9?kind=dog"; echo

echo "== 2. debug：变量渲染 + 提取写回环境变量 =="
cat > /tmp/debug-req.json <<JSON
{"type":"api_debug","envId":"$ENVID","request":{"method":"GET","url":"${base}/hello","headers":[],"query":[],"body":{"kind":"none"},"auth":{"kind":"none"},"timeoutMs":10000,"followRedirects":false,"skipPre":false,"skipPost":false},"asserts":[{"kind":"body_jsonpath","path":"$.message","op":"eq","expected":"hello"}],"pre":[{"kind":"script","script":"setVar(\"who\", \"smoke\"); log(\"hello from script\")"}],"post":[],"extracts":[{"source":"body","kind":"jsonpath","expression":"$.status","match":"first","variable":"svcState","scope":"env"}]}
JSON
TASK=$(curl -s -b /tmp/rabbit.jar -X POST $B/projects/$PID/exec-tasks -H 'Content-Type: application/json' -d @/tmp/debug-req.json | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['taskId'])")
for i in $(seq 1 15); do sleep 1; ST=$(curl -s -b /tmp/rabbit.jar $B/projects/$PID/reports/$TASK | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['status'])"); [ "$ST" != "PENDING" ] && [ "$ST" != "RUNNING" ] && break; done
echo "debug task=$TASK status=$ST"
curl -s -b /tmp/rabbit.jar $B/projects/$PID/reports/$TASK | python3 -c "
import sys,json
d=json.load(sys.stdin)['data']
print('渲染后 URL:', d['request']['url'])
print('extracts(经 step-result 帧在 itemFrames)：', d['response']['status'])
print('logs:', [l['message'] for l in d['logs']][:3])
"
echo "-- 环境变量写回（svcState 应为 UP）:"
curl -s -b /tmp/rabbit.jar $B/projects/$PID/environments/$ENVID | python3 -c "import sys,json;print([v for v in json.load(sys.stdin)['data']['config']['vars'] if v['key']=='svcState'])"

echo "== 3. 分享 =="
SH=$(curl -s -b /tmp/rabbit.jar -X POST $B/projects/$PID/reports/$TASK/shares -H 'Content-Type: application/json' -d '{"expireHours":1}')
echo "share: $SH"
TOKEN=$(echo "$SH" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['token'])")
curl -s "http://127.0.0.1:3000/api/v1/share/report/$TOKEN" | python3 -c "import sys,json;d=json.load(sys.stdin);print('免登读:', d['code'], d['data']['taskId']==('$TASK'), 'expireAt' in str(d))"
curl -s -o /dev/null -w "坏 token:%{http_code}\n" "http://127.0.0.1:3000/api/v1/share/report/not-exist"

echo "== 4. 重跑（对 FAILED 任务） =="
cat > /tmp/fail-case.json <<JSON
{"name":"必失败用例","level":"P2","status":"UNDERWAY","tags":[],"request":{"spec":{"method":"GET","url":"${base}/hello","headers":[],"query":[],"body":{"kind":"none"},"auth":{"kind":"none"},"timeoutMs":10000,"followRedirects":false,"skipPre":false,"skipPost":false},"asserts":[{"kind":"status_code","path":"","op":"eq","expected":"500"}],"pre":[],"post":[],"extracts":[]}}
JSON
FAILCASE=$(curl -s -b /tmp/rabbit.jar -X POST $B/projects/$PID/apis/$APIID/cases -H 'Content-Type: application/json' -d @/tmp/fail-case.json | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['id'])")
FTASK=$(curl -s -b /tmp/rabbit.jar -X POST $B/projects/$PID/apis/$APIID/cases/execute -H 'Content-Type: application/json' -d "{\"caseIds\":[\"$FAILCASE\"],\"envId\":\"$ENVID\",\"stopOnFail\":false}" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['taskId'])")
for i in $(seq 1 15); do sleep 1; ST=$(curl -s -b /tmp/rabbit.jar $B/projects/$PID/reports/$FTASK | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['status'])"); [ "$ST" != "PENDING" ] && [ "$ST" != "RUNNING" ] && break; done
echo "fail task=$FTASK status=$ST"
RTASK=$(curl -s -b /tmp/rabbit.jar -X POST $B/projects/$PID/exec-tasks/$FTASK/rerun | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['taskId'])")
echo "rerun new task=$RTASK (≠old: $([ "$RTASK" != "$FTASK" ] && echo yes || echo NO))"
curl -s -b /tmp/rabbit.jar "$B/projects/$PID/exec-tasks?pageSize=5" | python3 -c "
import sys,json
items=json.load(sys.stdin)['data']['items']
print('任务列表前3:', [(t['id'][:8], t['type'], t['status'], 'rerunOf='+t['rerunOf'][:8] if t['rerunOf'] else '-') for t in items[:3]])
"
echo "== 5. 停止（长任务：mock 延迟规则） =="
curl -s -b /tmp/rabbit.jar -X PUT $B/projects/$PID/apis/$APIID/mocks/$MOCKID -H 'Content-Type: application/json' -d '{"name":"慢响应","enabled":true,"followApi":false,"matchers":{"headers":[],"query":[]},"response":{"status":200,"headers":[],"body":"{}","delayMs":8000}}' >/dev/null
cat > /tmp/slow-case.json <<JSON
{"name":"慢用例","level":"P2","status":"UNDERWAY","tags":[],"request":{"spec":{"method":"GET","url":"${base}/mock/1/pets/1","headers":[],"query":[],"body":{"kind":"none"},"auth":{"kind":"none"},"timeoutMs":20000,"followRedirects":false,"skipPre":false,"skipPost":false},"asserts":[{"kind":"status_code","path":"","op":"eq","expected":"200"}],"pre":[],"post":[],"extracts":[]}}
JSON
SLOW=$(curl -s -b /tmp/rabbit.jar -X POST $B/projects/$PID/apis/$APIID/cases -H 'Content-Type: application/json' -d @/tmp/slow-case.json | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['id'])")
STASK=$(curl -s -b /tmp/rabbit.jar -X POST $B/projects/$PID/apis/$APIID/cases/execute -H 'Content-Type: application/json' -d "{\"caseIds\":[\"$SLOW\",\"$FAILCASE\"],\"envId\":\"$ENVID\",\"stopOnFail\":false}" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['taskId'])")
sleep 2
echo "stop → $(curl -s -b /tmp/rabbit.jar -X POST $B/projects/$PID/exec-tasks/$STASK/stop)"
for i in $(seq 1 15); do sleep 1; ST=$(curl -s -b /tmp/rabbit.jar $B/projects/$PID/reports/$STASK | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['status'])"); [ "$ST" != "PENDING" ] && [ "$ST" != "RUNNING" ] && break; done
echo "slow task=$STASK final=$ST"
echo "== 6. 任务中心全部项目 Tab =="
curl -s -b /tmp/rabbit.jar "$B/exec-tasks?pageSize=5" | python3 -c "import sys,json;d=json.load(sys.stdin);print('code',d['code'],'total',d['data']['total'])"
