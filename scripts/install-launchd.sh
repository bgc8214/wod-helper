#!/bin/bash
# launchd 자동 수집 잡 설치 헬퍼. 프로젝트 절대경로를 plist 에 주입 후 로드한다.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST_SRC="$DIR/scripts/com.wodhelper.collect.plist"
DEST="$HOME/Library/LaunchAgents/com.wodhelper.collect.plist"

mkdir -p "$HOME/Library/LaunchAgents" "$DIR/logs"
sed "s|__PROJECT_DIR__|$DIR|g" "$PLIST_SRC" > "$DEST"

launchctl unload "$DEST" 2>/dev/null || true
launchctl load "$DEST"
echo "설치 완료: $DEST"
echo "하루 3회(08/14/20시) 자동 수집. 즉시 1회도 실행됩니다(RunAtLoad)."
echo "해제: launchctl unload \"$DEST\""
