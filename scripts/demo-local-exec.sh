#!/usr/bin/env bash
# 验收标准 6：engine --local 本地执行模式（栈内无 worker，任务由 local CLI 执行并回环上报）
set -uo pipefail
cd "$(dirname "$0")/.."

# 槽位默认值（INFRA-005：jm 栈 web/mock/redis 随 worktree 槽位；显式 env 可覆盖）
eval "$(node scripts/rabbit-env.mjs --shell)"
BASE="${BASE:-$RABBIT_JM_WEB_URL}"
MOCK_ADDR="${MOCK_ADDR:-http://127.0.0.1:${RABBIT_JM_MOCK_PORT}}"
REDIS_URL_LOCAL="${REDIS_URL_LOCAL:-$RABBIT_JM_REDIS_URL}"
EMAIL="local-$(date +%s)@rabbit.test"

echo "[1/5] 注册用户"
curl -s -c /tmp/local-cj.txt -o /tmp/local-reg.json -X POST "$BASE/api/v1/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"rabbit-pass-123\"}"
PROJECT_ID="$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/local-reg.json','utf8')).data.projectId)")"
echo "  project=$PROJECT_ID"

echo "[2/5] 创建调试任务（无 worker 消费，保持 PENDING）"
cat > /tmp/local-task.json <<EOF
{"type":"api_debug","request":{"method":"GET","url":"${MOCK_ADDR}/hello","headers":[],"body":{"kind":"none","content":""}},"asserts":[{"kind":"status_code","path":"","op":"eq","expected":"200"}]}
EOF
curl -s -b /tmp/local-cj.txt -o /tmp/local-task-resp.json -X POST \
  "$BASE/api/v1/projects/$PROJECT_ID/exec-tasks" \
  -H 'Content-Type: application/json' -d @/tmp/local-task.json
TASK_ID="$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/local-task-resp.json','utf8')).data.taskId)")"
echo "  task=$TASK_ID"

echo "[3/5] engine --local 执行并回环上报"
REDIS_URL="$REDIS_URL_LOCAL" INTERNAL_TOKEN=jmeter-internal-token \
  pnpm --filter engine local -- --url "${MOCK_ADDR}/hello" --expect-status 200 \
  --task-id "$TASK_ID" --server "$BASE" || true

echo "[4/5] 查询报告"
for i in $(seq 1 20); do
  STATUS="$(curl -s -b /tmp/local-cj.txt "$BASE/api/v1/projects/$PROJECT_ID/reports/$TASK_ID" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).data.status))")"
  [ "$STATUS" = "SUCCESS" ] || [ "$STATUS" = "FAILED" ] && break
  sleep 1
done
echo "  status=$STATUS"

echo "[5/5] 断言"
if [ "$STATUS" = "SUCCESS" ]; then
  echo "LOCAL-EXEC: PASS（同一报告页可查看，验收标准 6 通过）"
  exit 0
else
  echo "LOCAL-EXEC: FAIL"
  exit 1
fi
