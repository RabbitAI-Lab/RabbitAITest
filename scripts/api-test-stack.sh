#!/usr/bin/env bash
# JMeter 接口测试专用栈：embedded PG(:5438) + 复用 rabbit-e2e-redis(:6381) + web(:3101) + engine + mock(:4000)
# 用法：bash scripts/api-test-stack.sh   （结束时统一回收）
set -euo pipefail
cd "$(dirname "$0")/.."

export PORT=3101
export WEB_URL=http://localhost:3101
export REDIS_URL=redis://127.0.0.1:6381
export SESSION_SECRET=jmeter-stack-secret-32chars-ok!!!
export INTERNAL_TOKEN=jmeter-internal-token
export SESSION_COOKIE_SECURE=false
# 用户上限与 CI/e2e 同口径 1000（全量计划注册用户 >30——产品默认 30 不变）
export RABBIT_USER_LIMIT=1000
# S7 AI-001：测试栈 mock 供应商在环回——守卫仅豁免环回，私网/元数据仍拦截。
# mock 端口独立 :4020（避开开发栈/s6 worktree :4000、e2e :4001、其他栈曾用 :4010——多 worktree 并存端口互抢教训；JM_MOCK_PORT 可覆盖）
JM_MOCK_PORT="${JM_MOCK_PORT:-4020}"
export AI_ALLOW_PRIVATE_BASEURL=1
# S7：种子内置一台指向 jmeter 栈 mock 的模型（baseUrl 须含 /ai 前缀——mock 路由 /ai/chat/completions）
export RABBIT_SEED_AI_MOCK_BASE="http://127.0.0.1:${JM_MOCK_PORT}/ai"

# redis(:6381) 已可达则直接复用（docker daemon 冷启动可绕行——本地 redis-server 同语义；4.1 环境复用）
nc -z 127.0.0.1 6381 2>/dev/null || {
  docker start rabbit-e2e-redis >/dev/null 2>&1 || docker run -d --name rabbit-e2e-redis -p 6381:6379 redis:7-alpine >/dev/null
}

PIDS=()
cleanup() {
  for p in "${PIDS[@]:-}"; do kill "$p" >/dev/null 2>&1 || true; done
  [ -n "${PG_PID:-}" ] && kill "$PG_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

node - <<'EOF' > /tmp/pg5438.pid &
import('embedded-postgres').then(async (m) => {
  const EP = m.default ?? m.EmbeddedPostgres ?? m;
  const fs = await import('node:fs');
  fs.rmSync('.pgdata-jm', { recursive: true, force: true });
  const pg = new EP({ databaseDir: '.pgdata-jm', user: 'postgres', password: 'postgres', port: 5438, persistent: false });
  process.on('SIGTERM', () => { pg.stop().finally(() => process.exit(0)); });
  process.on('SIGINT', () => { pg.stop().finally(() => process.exit(0)); });
  await pg.initialise(); await pg.start(); await pg.createDatabase('rabbit_jm');
  console.log('PG_READY');
  setInterval(() => {}, 1 << 30);
});
EOF
PG_PID=$!
for i in $(seq 1 60); do grep -q PG_READY /tmp/pg5438.pid 2>/dev/null && break; sleep 0.5; done
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5438/rabbit_jm

pnpm --filter @rabbit/db migrate-deploy >/dev/null
pnpm --filter @rabbit/db seed >/dev/null

pnpm --filter web start > /tmp/jm-web.log 2>&1 & PIDS+=($!)
if [ "${NO_ENGINE:-0}" != "1" ]; then
  pnpm --filter engine start > /tmp/jm-engine.log 2>&1 & PIDS+=($!)
fi
MOCK_PORT="$JM_MOCK_PORT" pnpm --filter mock start > /tmp/jm-mock.log 2>&1 & PIDS+=($!)

# mock 供应商就绪检查（AI 计划依赖；未就绪直接失败避免假绿）
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${JM_MOCK_PORT}/healthz" || true)
  [ "$code" = "200" ] && break
  sleep 1
done
[ "$code" = "200" ] || { echo "mock not ready on :${JM_MOCK_PORT}"; exit 1; }

for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3101/api/v1/system/ready || true)
  [ "$code" = "200" ] && break
  sleep 1
done
[ "$code" = "200" ] || { echo "stack not ready"; exit 1; }
echo "stack ready on :3101 (mock :${JM_MOCK_PORT})"

if [ -n "${RUN_SCRIPT:-}" ]; then
  bash "$RUN_SCRIPT"
  exit $?
fi

MOCK_URL="http://127.0.0.1:${JM_MOCK_PORT}/hello" MOCK_BASE="http://127.0.0.1:${JM_MOCK_PORT}/ai" MOCKPORT="$JM_MOCK_PORT" bash scripts/run-api-tests.sh http://localhost:3101
