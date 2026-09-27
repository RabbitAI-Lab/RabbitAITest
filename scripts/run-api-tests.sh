#!/usr/bin/env bash
# rules/testing.md §2：JMeter 接口自动化执行器（CI/本地对已启动的全栈服务执行）
# 用法：bash scripts/run-api-tests.sh [BASE_URL]   例：http://localhost:3101
set -uo pipefail

BASE_URL="${1:-${BASE_URL:-http://localhost:3101}}"
HOST="$(printf '%s' "$BASE_URL" | sed -E 's|https?://||' | cut -d: -f1)"
PORT="$(printf '%s' "$BASE_URL" | sed -nE 's|.*:([0-9]+)$|\1|p')"
PORT="${PORT:-80}"
MOCK_URL="${MOCK_URL:-http://127.0.0.1:4000/hello}"
OUT_DIR="test-results/api"
mkdir -p "$OUT_DIR"

if ! command -v jmeter >/dev/null 2>&1; then
  echo "missing jmeter (brew install jmeter)" >&2
  exit 2
fi

FAIL=0
MOCK_BASE="${MOCK_BASE:-http://127.0.0.1:4000}" # S7 AI：jmx 内 ${__P(MOCK_BASE)} 的 mock 供应商基地址
MOCKHOST="${MOCKHOST:-127.0.0.1}"              # API-005 直打 mock 的主机/端口（多栈并存端口漂移时注入）
MOCKPORT="${MOCKPORT:-4000}"
for plan in tests/api/*.jmx; do
  name="$(basename "$plan" .jmx)"
  echo "> $name"
  jtl="$OUT_DIR/$name.jtl"
  rm -f "$jtl" # jtl 追加式：清场避免上一轮失败行混入本轮计数
  jmeter -n -t "$plan" \
    -JHOST="$HOST" -JPORT="$PORT" -JMOCK_URL="$MOCK_URL" -JMOCK_BASE="$MOCK_BASE" -JMOCKHOST="$MOCKHOST" -JMOCKPORT="$MOCKPORT" \
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

if [ "$FAIL" -ne 0 ]; then
  echo "jmeter: FAILED ($BASE_URL)"
  exit 1
fi
echo "jmeter: ALL PASSED ($BASE_URL)"
exit 0
