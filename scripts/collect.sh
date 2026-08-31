#!/bin/bash
# WOD 수집 크론 진입점. launchd/cron 이 이 스크립트를 하루 몇 회 호출한다.
# 실패해도 기존 data/*.json 은 수집기가 알아서 보존한다.
set -euo pipefail

# 스크립트 위치 기준으로 프로젝트 루트 이동 (절대경로 안전)
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

# node 경로 (launchd 는 PATH 가 최소라 절대경로 우선 탐색)
NODE="$(command -v node || echo /usr/local/bin/node)"
[ -x "$NODE" ] || NODE=/opt/homebrew/bin/node

mkdir -p logs
TS="$(date '+%Y-%m-%d %H:%M:%S')"
echo "[$TS] collect start" >> logs/collect.log
"$NODE" collector/collect.js >> logs/collect.log 2>&1 || echo "[$TS] collect FAILED (기존 데이터 유지)" >> logs/collect.log
echo "[$TS] collect done" >> logs/collect.log
