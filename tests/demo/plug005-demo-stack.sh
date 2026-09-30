#!/usr/bin/env bash
# PLUG-005 验收演示栈（复录入库版）：web :3103 + engine + 内嵌 PG :5440 + redis :6381
# + rabbitmq :5672（docker 真服务）+ mongo :27017（docker 真服务，预置 plug005.items×3）
# + gRPC echo :50051 / SSH 服务 :2222（tests/demo/plug005-demo-targets.mjs 支撑进程）
# 用法：bash tests/demo/plug005-demo-stack.sh（DEMO_NO_RECORD=1 时只起栈不录制，Ctrl-C 回收）
set -euo pipefail
cd "$(dirname "$0")/../.."

export PORT=3103
export WEB_URL=http://localhost:3103
export REDIS_URL=redis://127.0.0.1:6381
export SESSION_SECRET=demo-plug005-stack-secret-32chars!
export INTERNAL_TOKEN=demo-plug005-internal-token
export SESSION_COOKIE_SECURE=false
export RABBIT_USER_LIMIT=1000
export PLUGIN_RUNNER_PORT=4032
export OUTBOUND_ALLOW_PRIVATE=1
export AI_ALLOW_PRIVATE_BASEURL=1
export RABBIT_INTEGRATION_SECRET="demo-plug005-integration-secret-32ch!!"
export LOG_LEVEL=info

pnpm build:plugins >/dev/null

# redis（复用既有容器）
nc -z 127.0.0.1 6381 2>/dev/null || {
  docker start rabbit-e2e-redis >/dev/null 2>&1 || docker run -d --name rabbit-e2e-redis -p 6381:6379 redis:7-alpine >/dev/null
}
# rabbitmq（真 broker，amqp 演示目标）
docker rm -f rabbit-demo-mq >/dev/null 2>&1 || true
docker run -d --name rabbit-demo-mq -p 5672:5672 \
  -e RABBITMQ_DEFAULT_USER=rabbitmq -e RABBITMQ_DEFAULT_PASS=rabbitmq \
  rabbitmq:3-alpine >/dev/null
# mongo（真 mongod，mongodb 演示目标）
docker rm -f rabbit-demo-mongo >/dev/null 2>&1 || true
docker run -d --name rabbit-demo-mongo -p 27017:27017 mongo:7 >/dev/null

PIDS=()
# 孤儿清扫（teardown 只杀 pnpm 包装进程会留 tsx 孙进程——多引擎抢同一队列的根源；
# 按 worktree 路径灭，避免误伤其他会话的栈）
sweep_orphans() {
  pkill -f "$PWD/apps/engine" 2>/dev/null || true
  pkill -f "$PWD/apps/web" 2>/dev/null || true
  pkill -f "$PWD/apps/mock" 2>/dev/null || true
}
sweep_orphans
sleep 1
cleanup() {
  for p in "${PIDS[@]:-}"; do kill "$p" >/dev/null 2>&1 || true; done
  sleep 1
  sweep_orphans
  docker rm -f rabbit-demo-mq rabbit-demo-mongo >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

# 内嵌 PG :5440（清场保证 201 首传画面）
rm -rf apps/web/data/plugins .pgdata-demo-plug005
node tests/demo/plug005-demo-pg.mjs > /tmp/plug005-demo-pg.log 2>&1 &
PIDS+=($!)
for i in $(seq 1 90); do grep -q PG_READY /tmp/plug005-demo-pg.log 2>/dev/null && break; sleep 1; done
grep -q PG_READY /tmp/plug005-demo-pg.log || { echo "PG not ready"; tail -5 /tmp/plug005-demo-pg.log; exit 1; }
echo "PG ready :5440"
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5440/rabbit_demo

pnpm --filter @rabbit/db migrate-deploy >/dev/null
pnpm --filter @rabbit/db seed >/dev/null
echo "migrate+seed done"

pnpm --filter web start > /tmp/plug005-demo-web.log 2>&1 & PIDS+=($!)
pnpm --filter engine start > /tmp/plug005-demo-engine.log 2>&1 & PIDS+=($!)

for i in $(seq 1 90); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3103/api/v1/system/ready" || true)
  [ "$code" = "200" ] && break; sleep 1
done
echo "web :3103 $code"

# 演示目标支撑进程（gRPC echo + SSH 服务 + mongo 预置 + rabbitmq/mongo 就绪探针）
node tests/demo/plug005-demo-targets.mjs > /tmp/plug005-demo-targets.log 2>&1 &
PIDS+=($!)
for i in $(seq 1 120); do grep -q "ALL TARGETS READY" /tmp/plug005-demo-targets.log 2>/dev/null && break; sleep 1; done
grep -q "ALL TARGETS READY" /tmp/plug005-demo-targets.log || { echo "targets not ready"; cat /tmp/plug005-demo-targets.log; exit 1; }
echo "demo targets ready (grpc :50051 / ssh :2222 / amqp :5672 / mongo :27017 / redis :6381)"

# 录制（Playwright 运镜）；DEMO_NO_RECORD=1 时跳过（受控实验/手动驱动）
if [ -z "${DEMO_NO_RECORD:-}" ]; then
  node tests/demo/plug005-demo-record.mjs
  REC_RC=$?
else
  REC_RC=0
  echo "stack ready (no-record mode). Ctrl-C to tear down."
  wait
fi
echo "recorder rc=$REC_RC"

# 视频重命名固定名（取 OUT 目录最新 webm）
OUT_DIR=docs/sprint-future-p4/demo
LATEST=$(ls -t "$OUT_DIR"/*.webm 2>/dev/null | head -1)
if [ -n "$LATEST" ] && [ "$(basename "$LATEST")" != "plug005-acceptance-demo.webm" ]; then
  mv "$LATEST" "$OUT_DIR/plug005-acceptance-demo.webm"
fi
ls -la "$OUT_DIR"/plug005-acceptance-demo.webm
exit $REC_RC
