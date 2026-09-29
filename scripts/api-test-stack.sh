#!/usr/bin/env bash
# JMeter 接口测试专用栈：embedded PG(5460+slot) + 共享 rabbit-e2e-redis(:6381，键空间按逻辑库=slot 隔离)
# + web(3200+slot) + engine + mock(4200+slot)——INFRA-005 worktree 槽位隔离，
# 端口/Redis/临时路径全部出自 scripts/rabbit-env.mjs（禁止硬编码，rules/git-workflow §9）
# 用法：bash scripts/api-test-stack.sh   （结束时统一回收）
set -euo pipefail
cd "$(dirname "$0")/.."

# 槽位环境（RABBIT_SLOT > 目录名 RabbitAITest-s{N} > 0）；RABBIT_* 仅作默认值，显式 env 可覆盖
eval "$(node scripts/rabbit-env.mjs --shell)"

export PORT="${PORT:-$RABBIT_JM_WEB_PORT}"
export WEB_URL="${WEB_URL:-$RABBIT_JM_WEB_URL}"
export REDIS_URL="${REDIS_URL:-$RABBIT_JM_REDIS_URL}"
export SESSION_SECRET=jmeter-stack-secret-32chars-ok!!!
export INTERNAL_TOKEN=jmeter-internal-token
export SESSION_COOKIE_SECURE=false
# 用户上限与 CI/e2e 同口径 1000（全量计划注册用户 >30——产品默认 30 不变）
export RABBIT_USER_LIMIT=1000
# S7 AI-001：测试栈 mock 供应商在环回——守卫仅豁免环回，私网/元数据仍拦截。
# mock 端口随槽位 4200+slot（JM_MOCK_PORT 可覆盖）
export AI_ALLOW_PRIVATE_BASEURL=1
export JM_MOCK_PORT="${JM_MOCK_PORT:-$RABBIT_JM_MOCK_PORT}" # export：S8 起 baseline step 子 shell 依赖（58e153e 教训）
# S-future PLUG-003：内嵌 plugin-runner 端口随槽位（原上游固定 4030——多 worktree 并存互抢，INFRA-005 收编入表）。
# 只设 PORT 不设 URL（URL 显式配置=禁用内嵌启动，instrumentation-node §startPluginRunner）
export PLUGIN_RUNNER_PORT="${PLUGIN_RUNNER_PORT:-$RABBIT_JM_RUNNER_PORT}"
# S-future EXEC-004：K8S apiServer 试连测试豁免环回（本机无集群；生产默认拒环回）
export POOL_K8S_ALLOW_LOOPBACK="${POOL_K8S_ALLOW_LOOPBACK:-1}"
# S7：种子内置一台指向 jmeter 栈 mock 的模型（baseUrl 须含 /ai 前缀——mock 路由 /ai/chat/completions）
export RABBIT_SEED_AI_MOCK_BASE="${RABBIT_SEED_AI_MOCK_BASE:-http://127.0.0.1:${JM_MOCK_PORT}/ai}"

# redis 实例(:6381) 已可达则直接复用（键空间按逻辑库号=slot 隔离——多 worktree 并行不串台；
# docker daemon 冷启动可绕行——本地 redis-server 同语义；AGENTS §4.1 环境复用）
nc -z 127.0.0.1 "$RABBIT_JM_REDIS_PORT" 2>/dev/null || {
  docker start rabbit-e2e-redis >/dev/null 2>&1 || docker run -d --name rabbit-e2e-redis -p 6381:6379 redis:7-alpine >/dev/null
}

# 槽位专属临时目录（原共享 /tmp/pg5438.pid、/tmp/jm-*.log 弃用——并行会话互踩教训）
mkdir -p "$RABBIT_JM_TMP_DIR"
PIDS=()
cleanup() {
  for p in "${PIDS[@]:-}"; do kill "$p" >/dev/null 2>&1 || true; done
  [ -n "${PG_PID:-}" ] && kill "$PG_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

node - "$RABBIT_JM_PG_PORT" > "$RABBIT_JM_TMP_DIR/pg.out" <<'EOF' &
import('embedded-postgres').then(async (m) => {
  const EP = m.default ?? m.EmbeddedPostgres ?? m;
  const fs = await import('node:fs');
  fs.rmSync('.pgdata-jm', { recursive: true, force: true });
  const pg = new EP({ databaseDir: '.pgdata-jm', user: 'postgres', password: 'postgres', port: Number(process.argv[2]), persistent: false });
  process.on('SIGTERM', () => { pg.stop().finally(() => process.exit(0)); });
  process.on('SIGINT', () => { pg.stop().finally(() => process.exit(0)); });
  await pg.initialise(); await pg.start(); await pg.createDatabase('rabbit_jm');
  console.log('PG_READY');
  setInterval(() => {}, 1 << 30);
});
EOF
PG_PID=$!
for i in $(seq 1 60); do grep -q PG_READY "$RABBIT_JM_TMP_DIR/pg.out" 2>/dev/null && break; sleep 0.5; done
export DATABASE_URL="${DATABASE_URL:-$RABBIT_JM_DATABASE_URL}"

pnpm --filter @rabbit/db migrate-deploy >/dev/null
pnpm --filter @rabbit/db seed >/dev/null

pnpm --filter web start > "$RABBIT_JM_TMP_DIR/web.log" 2>&1 & PIDS+=($!)
if [ "${NO_ENGINE:-0}" != "1" ]; then
  pnpm --filter engine start > "$RABBIT_JM_TMP_DIR/engine.log" 2>&1 & PIDS+=($!)
fi
MOCK_PORT="$JM_MOCK_PORT" pnpm --filter mock start > "$RABBIT_JM_TMP_DIR/mock.log" 2>&1 & PIDS+=($!)

# mock 供应商就绪检查（AI 计划依赖；未就绪直接失败避免假绿）
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${JM_MOCK_PORT}/healthz" || true)
  [ "$code" = "200" ] && break
  sleep 1
done
[ "$code" = "200" ] || { echo "mock not ready on :${JM_MOCK_PORT}"; exit 1; }

for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "${WEB_URL}/api/v1/system/ready" || true)
  [ "$code" = "200" ] && break
  sleep 1
done
[ "$code" = "200" ] || { echo "stack not ready"; exit 1; }
echo "stack ready on :${PORT} (mock :${JM_MOCK_PORT}, slot=${RABBIT_SLOT}, tmp ${RABBIT_JM_TMP_DIR})"

if [ -n "${RUN_SCRIPT:-}" ]; then
  bash "$RUN_SCRIPT"
  exit $?
fi

MOCK_URL="http://127.0.0.1:${JM_MOCK_PORT}/hello" MOCK_BASE="http://127.0.0.1:${JM_MOCK_PORT}/ai" MOCKPORT="$JM_MOCK_PORT" MOCK_PORT="$JM_MOCK_PORT" bash scripts/run-api-tests.sh "$WEB_URL"
