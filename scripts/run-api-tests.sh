#!/usr/bin/env bash
# rules/testing.md §2：JMeter 接口自动化执行器（CI/本地对已启动的全栈服务执行）
# 用法：bash scripts/run-api-tests.sh [BASE_URL] [--shard=N/M]   例：http://localhost:3200（jm 栈，随 worktree 槽位）
#   --shard=N/M：CI 分片并行（round-robin 取模选计划，M=2 即两 job 各跑一半）。
#   分片安全边界：各分片必须跑在独立栈/独立 DB 上——计划间存在全局单例（license/系统参数/AI 模型
#   默认标记）与共用种子 admin@rabbit.test，共享栈并发会互踩（审计 2026-09-29）。
# 默认值按槽位推导（INFRA-005：RABBIT_SLOT > 目录名 RabbitAITest-s{N} > 0）；显式 env/参数仍可覆盖
set -uo pipefail

eval "$(node scripts/rabbit-env.mjs --shell)"

BASE_URL="${BASE_URL:-$RABBIT_JM_WEB_URL}"
SHARD_N=1
SHARD_M=1
for arg in "$@"; do
  case "$arg" in
    --shard=*)
      IFS=/ read -r SHARD_N SHARD_M <<< "${arg#--shard=}"
      ;;
    --*) ;;
    *) BASE_URL="$arg" ;;
  esac
done
if ! [ "$SHARD_M" -ge 1 ] 2>/dev/null || ! [ "$SHARD_N" -ge 1 ] 2>/dev/null || [ "$SHARD_N" -gt "$SHARD_M" ]; then
  echo "invalid --shard=N/M (got N=$SHARD_N M=$SHARD_M)" >&2
  exit 2
fi
HOST="$(printf '%s' "$BASE_URL" | sed -E 's|https?://||' | cut -d: -f1)"
PORT="$(printf '%s' "$BASE_URL" | sed -nE 's|.*:([0-9]+)$|\1|p')"
PORT="${PORT:-80}"
MOCK_URL="${MOCK_URL:-http://127.0.0.1:${RABBIT_JM_MOCK_PORT}/hello}"
OUT_DIR="test-results/api"
mkdir -p "$OUT_DIR"

if ! command -v jmeter >/dev/null 2>&1; then
  echo "missing jmeter (brew install jmeter)" >&2
  exit 2
fi

FAIL=0
MOCK_BASE="${MOCK_BASE:-http://127.0.0.1:${RABBIT_JM_MOCK_PORT}/ai}" # S7 AI：jmx 内 ${__P(MOCK_BASE)} 的 mock 供应商基地址（含 /ai 前缀——mock 路由 /ai/chat/completions）
MOCKHOST="${MOCKHOST:-127.0.0.1}"              # API-005 直打 mock 的主机/端口（多栈并存端口漂移时注入）
MOCKPORT="${MOCKPORT:-$RABBIT_JM_MOCK_PORT}"
PLANS=()
while IFS= read -r p; do PLANS+=("$p"); done < <(ls tests/api/*.jmx | sort)
TOTAL_PLANS="${#PLANS[@]}"
[ "$TOTAL_PLANS" -gt 0 ] || { echo "no .jmx plans under tests/api/" >&2; exit 2; }
SELECTED=0
i=0
for plan in "${PLANS[@]}"; do
  i=$((i + 1))
  # 分片 round-robin（1 基取模）：字母序前缀（AI/API/BUG…）均匀打散到各分片
  if [ "$SHARD_M" -gt 1 ] && [ $(((i - 1) % SHARD_M)) -ne $((SHARD_N - 1)) ]; then
    continue
  fi
  SELECTED=$((SELECTED + 1))
  name="$(basename "$plan" .jmx)"
  if [ "$SHARD_M" -gt 1 ]; then
    echo "> $name [shard $SHARD_N/$SHARD_M]"
  else
    echo "> $name"
  fi
  jtl="$OUT_DIR/$name.jtl"
  rm -f "$jtl" # jtl 追加式：清场避免上一轮失败行混入本轮计数
  jmeter -n -t "$plan" \
    -JHOST="$HOST" -JPORT="$PORT" -JMOCK_URL="$MOCK_URL" -JMOCK_BASE="$MOCK_BASE" -JMOCKHOST="$MOCKHOST" -JMOCKPORT="${MOCKPORT:-${MOCK_PORT:-$RABBIT_JM_MOCK_PORT}}" -JMOCK_PORT="${MOCK_PORT:-$RABBIT_JM_MOCK_PORT}" \
    -JINTERNAL_TOKEN="${INTERNAL_TOKEN:-jmeter-internal-token}" \
    -JPGURL="${PGURL:-$RABBIT_JM_DATABASE_URL}" \
    -l "$jtl" -j "$OUT_DIR/$name.log" >/dev/null 2>&1
  if [ ! -f "$jtl" ]; then
    echo "  FAIL: no jtl produced"
    FAIL=1
    continue
  fi
  # JMeter 5.6 默认 CSV jtl：success 列（第 8 列）为 false 即断言/采样失败。
  # 勘误（2026-09-27）：原实现 grep '<error>true</error>'（XML 格式）对 CSV 恒不命中，
  # 门禁空转——S1 期间任何断言失败都被漏放。本修复恢复真实校验。
  err_count="$(awk -F, 'NR>1 && $8=="false"' "$jtl" | wc -l | tr -d ' ')"
  if [ "$err_count" -gt 0 ] 2>/dev/null; then
    echo "  FAIL: $err_count sampler(s) failed (see $jtl)"
    awk -F, 'NR>1 && $8=="false" {print "    ✗ " $3 " " $1 " " $5}' "$jtl" | head -5
    FAIL=1
  else
    echo "  PASS: all assertions passed"
  fi
done

if [ "$SELECTED" -eq 0 ]; then
  echo "shard $SHARD_N/$SHARD_M selected 0/$TOTAL_PLANS plans — 配置错误" >&2
  exit 2
fi

if [ "$FAIL" -ne 0 ]; then
  echo "jmeter: FAILED ($BASE_URL, shard $SHARD_N/$SHARD_M, $SELECTED/$TOTAL_PLANS plans)"
  exit 1
fi
echo "jmeter: ALL PASSED ($BASE_URL, shard $SHARD_N/$SHARD_M, $SELECTED/$TOTAL_PLANS plans)"
exit 0
