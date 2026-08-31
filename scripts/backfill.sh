#!/bin/bash
# 과거 WOD 일괄 수집(일회성). 분기 단위로 나눠 API 부담을 낮추고,
# 각 구간 사이에 쉬어 간다. 중단해도 이미 저장된 아카이브는 남는다.
#
# 사용:  bash scripts/backfill.sh [시작연도] [종료연도]
#        bash scripts/backfill.sh 2021 2026
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

NODE="$(command -v node || echo /opt/homebrew/bin/node)"
START_YEAR="${1:-2021}"
END_YEAR="${2:-$(date +%Y)}"
SLEEP_SEC="${BACKFILL_SLEEP:-2}"

mkdir -p logs
LOG="logs/backfill.log"
echo "=== backfill $START_YEAR~$END_YEAR 시작 $(date '+%F %T') ===" >> "$LOG"

ok=0; fail=0
for year in $(seq "$START_YEAR" "$END_YEAR"); do
  for qtr in 1 2 3 4; do
    case $qtr in
      1) from="$year-01-01"; to="$year-03-31" ;;
      2) from="$year-04-01"; to="$year-06-30" ;;
      3) from="$year-07-01"; to="$year-09-30" ;;
      4) from="$year-10-01"; to="$year-12-31" ;;
    esac
    # 미래 분기는 건너뜀
    [ "$from" \> "$(date +%F)" ] && continue

    printf '[backfill] %s ~ %s ... ' "$from" "$to" | tee -a "$LOG"
    if out=$("$NODE" collector/collect.js --from "$from" --to "$to" --quiet 2>&1); then
      echo "OK" | tee -a "$LOG"
      ok=$((ok+1))
    else
      echo "FAIL: $(echo "$out" | tail -1)" | tee -a "$LOG"
      fail=$((fail+1))
    fi
    sleep "$SLEEP_SEC"
  done
done

echo "=== backfill 완료: 성공 $ok / 실패 $fail · $(date '+%F %T') ===" | tee -a "$LOG"
