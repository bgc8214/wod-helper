#!/bin/bash
# WOD 수집 크론 진입점. launchd/cron 이 이 스크립트를 하루 몇 회 호출한다.
# 실패해도 기존 data/*.json 은 수집기가 알아서 보존한다.
set -euo pipefail

# 스크립트 위치 기준으로 프로젝트 루트 이동 (절대경로 안전)
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

# node/vercel 경로 (launchd 는 PATH 가 최소라 절대경로 우선 탐색)
NODE="$(command -v node || echo /usr/local/bin/node)"
[ -x "$NODE" ] || NODE=/opt/homebrew/bin/node
VERCEL="$(command -v vercel || echo /opt/homebrew/bin/vercel)"

# .env 에 VERCEL_TOKEN 이 있으면 launchd 세션에서도 배포 인증에 사용(선택)
if [ -f .env ]; then
  VT="$(grep -E '^VERCEL_TOKEN=' .env | head -1 | cut -d= -f2-)"
  VT="${VT%\"}"; VT="${VT#\"}"   # 양끝 큰따옴표 제거
  [ -n "${VT:-}" ] && export VERCEL_TOKEN="$VT"
fi

mkdir -p logs
TS="$(date '+%Y-%m-%d %H:%M:%S')"
echo "[$TS] collect start" >> logs/collect.log
"$NODE" collector/collect.js >> logs/collect.log 2>&1 || echo "[$TS] collect FAILED (기존 데이터 유지)" >> logs/collect.log

# 데이터가 갱신됐으면 (1) 소스 백업용 git push, (2) Vercel 호스팅 배포
if ! git diff --quiet -- data/latest.json data/latest.js 2>/dev/null; then
  # (1) GitHub 에 소스·데이터 백업
  git add data/latest.json data/latest.js
  if git commit -m "chore: WOD 데이터 자동 갱신 ($TS)" >> logs/collect.log 2>&1; then
    git push origin main >> logs/collect.log 2>&1 \
      && echo "[$TS] git push 완료" >> logs/collect.log \
      || echo "[$TS] git push FAILED (다음 실행 때 재시도)" >> logs/collect.log
  fi

  # (2) Vercel 프로덕션 배포 (실제 폰에서 보는 사이트)
  TOKEN_ARG=""
  [ -n "${VERCEL_TOKEN:-}" ] && TOKEN_ARG="--token=$VERCEL_TOKEN"
  if "$VERCEL" deploy --prod --yes $TOKEN_ARG >> logs/collect.log 2>&1; then
    echo "[$TS] Vercel 배포 완료 → https://wod-helper.vercel.app" >> logs/collect.log
  else
    echo "[$TS] Vercel 배포 FAILED (다음 실행 때 재시도)" >> logs/collect.log
  fi
fi

echo "[$TS] collect done" >> logs/collect.log
