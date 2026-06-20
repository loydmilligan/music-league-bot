#!/usr/bin/env bash
# mlb-download — fetch output files from the last agent session
#
# Usage:
#   mlb-download [--session SESSION_ID] [--out DIR]
#
# --session  override the session ID (default: SESSION_ID from IDS.env)
# --out      directory to write downloaded files (default: . / my-agent/)
#
# With no args, downloads sharing-ready.md from the most recent session.
#
# Examples:
#   mlb-download
#   mlb-download --session abc123 --out ~/Downloads

set -euo pipefail
cd "$(dirname "$0")"

SESSION_OVERRIDE=""
OUT_DIR="."

while [[ $# -gt 0 ]]; do
  case "$1" in
    --session) SESSION_OVERRIDE="$2"; shift 2 ;;
    --out)     OUT_DIR="$2";          shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

[ ! -f .env ]     && { echo "Error: .env not found (need ANTHROPIC_API_KEY)"; exit 1; }
[ ! -f IDS.env ]  && { echo "Error: IDS.env not found (run mlb-run first)"; exit 1; }

set -a; source .env; source IDS.env; set +a

[ -z "${ANTHROPIC_API_KEY:-}" ] && { echo "Error: ANTHROPIC_API_KEY not set"; exit 1; }

TARGET_SESSION="${SESSION_OVERRIDE:-${SESSION_ID:-}}"
[ -z "$TARGET_SESSION" ] && { echo "Error: no session ID — either run mlb-run first or pass --session"; exit 1; }

BASE="https://api.anthropic.com/v1"
H=(-H "x-api-key: $ANTHROPIC_API_KEY"
   -H "anthropic-version: 2023-06-01"
   -H "anthropic-beta: managed-agents-2026-04-01")

echo "Session: $TARGET_SESSION"
echo "Listing output files..."

FILES_JSON=$(curl -sS "$BASE/files?scope_id=$TARGET_SESSION" "${H[@]}")

FILE_LIST=$(python3 -c "
import json, sys
d = json.loads('''$FILES_JSON''')
files = d.get('data', [])
if not files:
    print('NO_FILES')
else:
    for f in files:
        print(f['id'] + '|' + f['filename'])
")

if [ "$FILE_LIST" = "NO_FILES" ]; then
  echo "No output files found for session $TARGET_SESSION"
  exit 0
fi

mkdir -p "$OUT_DIR"

echo ""
while IFS='|' read -r file_id filename; do
  dest="$OUT_DIR/$filename"
  echo "Downloading $filename → $dest"
  curl -sS "$BASE/files/$file_id/content" "${H[@]}" -o "$dest"
done <<< "$FILE_LIST"

echo ""
SHARING="$OUT_DIR/sharing-ready.md"
if [ -f "$SHARING" ]; then
  echo "=== sharing-ready.md ==="
  cat "$SHARING"
fi
