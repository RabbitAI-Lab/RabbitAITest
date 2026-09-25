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
for plan in tests/api/*.jmx; do
  name="$(basename "$plan" .jmx)"
  echo "> $name"
  jtl="$OUT_DIR/$name.jtl"
  jmeter -n -t "$plan" \
    -JHOST="$HOST" -JPORT="$PORT" -JMOCK_URL="$MOCK_URL" \
    -l "$jtl" -j "$OUT_DIR/$name.log" >/dev/null 2>&1
  if [ ! -f "$jtl" ]; then
    echo "  FAIL: no jtl produced"
    FAIL=1
    continue
  fi
  err_count="$(grep -c '<error>true</error>' "$jtl" || true)"
  err_count="${err_count:-0}"
  if [ "$err_count" -gt 0 ] 2>/dev/null; then
    echo "  FAIL: $err_count sampler(s) failed (see $jtl)"
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
