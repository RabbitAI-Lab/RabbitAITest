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

docker start rabbit-e2e-redis >/dev/null 2>&1 || docker run -d --name rabbit-e2e-redis -p 6381:6379 redis:7-alpine >/dev/null

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
pnpm --filter mock start > /tmp/jm-mock.log 2>&1 & PIDS+=($!)

for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3101/api/v1/system/ready || true)
  [ "$code" = "200" ] && break
  sleep 1
done
[ "$code" = "200" ] || { echo "stack not ready"; exit 1; }
echo "stack ready on :3101 (mock :4000)"

if [ -n "${RUN_SCRIPT:-}" ]; then
  bash "$RUN_SCRIPT"
  exit $?
fi

bash scripts/run-api-tests.sh http://localhost:3101
