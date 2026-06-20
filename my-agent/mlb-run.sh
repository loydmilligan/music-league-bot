#!/usr/bin/env bash
# mlb-run — kick off the round-transition-agent
#
# Usage:
#   mlb-run --round ROUND_ID [--league LEAGUE_ID] [--chat FILE_OR_TEXT]
#
# --chat can be:
#   a file path   → parses it, filters to the round's date window (submission → voting + 3 days)
#   quoted text   → used verbatim
#   omitted       → auto-detect from ~/Downloads/mlb-chat/ (see below)
#
# Auto chat ingestion (when --chat is omitted):
#   Drop a WhatsApp export zip into ~/Downloads/mlb-chat/.
#   The zip is matched to the current league by word overlap between the
#   zip filename and the league name (e.g. "Hip Jammers" → *hip jammers*.zip).
#   First run:  finds the matching unprocessed zip, extracts it, renames *.done.zip
#   Regen run:  no unprocessed zip → uses most-recently-modified matching *.done.zip
#   No match:   chat is skipped
#
# Examples:
#   mlb-run --round 108
#   mlb-run --round 108 --chat ~/Downloads/"WhatsApp Chat with Hip jammers.txt"
#   mlb-run --round 108 --chat "Ron: lol this song slaps"

set -euo pipefail
cd "$(dirname "$0")"

ROUND_ID=""
LEAGUE_ID=""
CHAT_INPUT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --round)   ROUND_ID="$2";   shift 2 ;;
    --league)  LEAGUE_ID="$2";  shift 2 ;;
    --chat)    CHAT_INPUT="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

[ -z "$ROUND_ID" ] && { echo "Error: --round ROUND_ID is required"; exit 1; }

# -- Look up round and league info from the DB --
DB=/home/loydmilligan/Projects/music-league-bot/data/league.db

ROUND_INFO=$(python3 -c "
import sqlite3, json
db = sqlite3.connect('$DB')
row = db.execute('''
  SELECT r.id, r.name, r.submission_deadline, r.voting_deadline, s.league_id
  FROM rounds r JOIN seasons s ON s.id = r.season_id
  WHERE r.id = ?
''', ($ROUND_ID,)).fetchone()
if not row:
    print('ERROR: round not found')
else:
    print(json.dumps({'id': row[0], 'name': row[1], 'sub': row[2], 'vote': row[3], 'league_id': row[4]}))
db.close()
")

[ "$ROUND_INFO" = "ERROR: round not found" ] && { echo "Error: round $ROUND_ID not found in DB"; exit 1; }

LEAGUE_FROM_DB=$(python3 -c "import json; print(json.loads('$ROUND_INFO')['league_id'])")
ROUND_NAME=$(python3 -c "import json; print(json.loads('$ROUND_INFO')['name'])")
SUB_DEADLINE=$(python3 -c "import json; print(json.loads('$ROUND_INFO')['sub'] or '')")
VOTE_DEADLINE=$(python3 -c "import json; print(json.loads('$ROUND_INFO')['vote'] or '')")

[ -z "$LEAGUE_ID" ] && LEAGUE_ID="$LEAGUE_FROM_DB"

LEAGUE_NAME=$(python3 -c "
import sqlite3
db = sqlite3.connect('$DB')
row = db.execute('SELECT name FROM leagues WHERE id = ?', ($LEAGUE_ID,)).fetchone()
print(row[0] if row else 'Unknown')
db.close()
")

echo "Round: [$ROUND_ID] $ROUND_NAME"
echo "League: [$LEAGUE_ID] $LEAGUE_NAME"
echo "Dates: sub=$SUB_DEADLINE  vote=$VOTE_DEADLINE"

# -- Auto-detect chat from ~/Downloads/mlb-chat/ when --chat not given --
MLB_CHAT_DIR="$HOME/Downloads/mlb-chat"
EXTRACTED_TXT=""  # set below if we extract from a zip; cleaned up afterward

extract_zip() {
  local zip_path="$1"
  EXTRACTED_TXT=$(mktemp /tmp/mlb-chat-XXXXXX.txt)
  python3 -c "
import zipfile, sys
with zipfile.ZipFile('$zip_path') as z:
    txts = [n for n in z.namelist() if n.endswith('.txt')]
    if not txts:
        print('ERROR: no .txt in zip', file=sys.stderr); sys.exit(1)
    with z.open(txts[0]) as src, open('$EXTRACTED_TXT', 'wb') as dst:
        dst.write(src.read())
"
}

# Score a zip filename against the league name: count words (>2 chars) in common
score_match() {
  python3 -c "
import os, re
league = '$LEAGUE_NAME'.lower()
fname  = os.path.basename('$1').lower()
words  = [w for w in re.split(r'\W+', league) if len(w) > 2]
print(sum(1 for w in words if w in fname))
"
}

if [ -z "$CHAT_INPUT" ] && [ -d "$MLB_CHAT_DIR" ]; then
  # Collect all unprocessed zips, score each against league name, pick best match
  BEST_SCORE=0
  BEST_UNPROCESSED=""
  BEST_MTIME=0
  while IFS= read -r -d '' zipfile; do
    score=$(score_match "$zipfile")
    mtime=$(stat -c %Y "$zipfile" 2>/dev/null || echo 0)
    if [ "$score" -gt "$BEST_SCORE" ] || { [ "$score" -eq "$BEST_SCORE" ] && [ "$mtime" -gt "$BEST_MTIME" ]; }; then
      BEST_SCORE="$score"
      BEST_UNPROCESSED="$zipfile"
      BEST_MTIME="$mtime"
    fi
  done < <(find "$MLB_CHAT_DIR" -maxdepth 1 -name "*.zip" ! -name "*.done.*" -print0 2>/dev/null)

  if [ "$BEST_SCORE" -gt 0 ] && [ -n "$BEST_UNPROCESSED" ]; then
    extract_zip "$BEST_UNPROCESSED"
    DONE_NAME="${BEST_UNPROCESSED%.zip}.done.zip"
    mv "$BEST_UNPROCESSED" "$DONE_NAME"
    echo "Chat: $(basename "$BEST_UNPROCESSED") → $(basename "$DONE_NAME") (score=$BEST_SCORE)"
    CHAT_INPUT="$EXTRACTED_TXT"

  else
    # Regen: no matching unprocessed zip — find best matching processed zip
    BEST_SCORE=0
    BEST_PROCESSED=""
    BEST_MTIME=0
    while IFS= read -r -d '' zipfile; do
      score=$(score_match "$zipfile")
      mtime=$(stat -c %Y "$zipfile" 2>/dev/null || echo 0)
      if [ "$score" -gt "$BEST_SCORE" ] || { [ "$score" -eq "$BEST_SCORE" ] && [ "$mtime" -gt "$BEST_MTIME" ]; }; then
        BEST_SCORE="$score"
        BEST_PROCESSED="$zipfile"
        BEST_MTIME="$mtime"
      fi
    done < <(find "$MLB_CHAT_DIR" -maxdepth 1 -name "*.done.zip" -print0 2>/dev/null)

    if [ "$BEST_SCORE" -gt 0 ] && [ -n "$BEST_PROCESSED" ]; then
      extract_zip "$BEST_PROCESSED"
      echo "Chat: regen — $(basename "$BEST_PROCESSED") (score=$BEST_SCORE)"
      CHAT_INPUT="$EXTRACTED_TXT"
    elif [ -n "$BEST_PROCESSED" ]; then
      # Fallback: no word match at all, just use most recent processed zip and warn
      extract_zip "$BEST_PROCESSED"
      echo "Chat: regen — no league match found; using most recent: $(basename "$BEST_PROCESSED") (check this is the right chat)"
      CHAT_INPUT="$EXTRACTED_TXT"
    else
      echo "Chat: no zip found in $MLB_CHAT_DIR — skipping chat"
    fi
  fi
fi

# -- Handle chat input --
CHAT_CONTENT="none"

if [ -n "$CHAT_INPUT" ]; then
  if [ -f "$CHAT_INPUT" ]; then
    echo "Chat: filtering to round date window..."
    CHAT_CONTENT=$(python3 << PYEOF
import re, sys
from datetime import datetime, timedelta

sub_str = """$SUB_DEADLINE"""
vote_str = """$VOTE_DEADLINE"""

def parse_round_date(s):
    for fmt in ('%Y-%m-%dT%H:%M:%S', '%Y-%m-%d'):
        try: return datetime.strptime(s[:len(fmt)], fmt)
        except: pass
    return None

window_start = parse_round_date(sub_str) - timedelta(days=1) if parse_round_date(sub_str) else None
window_end   = parse_round_date(vote_str) + timedelta(days=3) if parse_round_date(vote_str) else None

line_re = re.compile(r'^(\d{1,2}/\d{1,2}/\d{2}), \d{1,2}:\d{2} [AP]M - ')

lines = open("""$CHAT_INPUT""", encoding='utf-8', errors='replace').readlines()
out = []
current_in_window = False

for line in lines:
    m = line_re.match(line)
    if m:
        try:
            dt = datetime.strptime(m.group(1), '%m/%d/%y')
        except:
            dt = None
        if dt and window_start and window_end:
            current_in_window = window_start <= dt <= window_end
        elif not window_start:
            current_in_window = True
    if current_in_window:
        out.append(line.rstrip())

if not out:
    print("(no messages found in round date window — check that the file covers this period)")
else:
    print(f"[{len(out)} lines from {window_start.date() if window_start else '?'} to {window_end.date() if window_end else '?'}]")
    print('\n'.join(out))
PYEOF
)
    LINE_COUNT=$(echo "$CHAT_CONTENT" | wc -l)
    echo "Chat: extracted ~$LINE_COUNT lines"
  else
    echo "Chat: using provided text"
    CHAT_CONTENT="$CHAT_INPUT"
  fi
fi

# -- Write first_prompt.txt --
cat > first_prompt.txt << PROMPT
Automate the round transition for Music League.

League: $LEAGUE_NAME
League ID: $LEAGUE_ID
Round ID: $ROUND_ID

Chat content:
$CHAT_CONTENT

Run the full pipeline: confirm state → end voting (if needed) → validate data → generate digest → export HTML → finalize → advance to next round (if this is the current active round).

Write sharing-ready.md to /mnt/session/outputs/ with the digest URL and per-league sharing message, then print the same summary.
PROMPT

echo ""
echo "first_prompt.txt written. Launching agent..."
echo ""
bash launch.sh

# Clean up temp extracted txt (if we created one)
[ -n "$EXTRACTED_TXT" ] && rm -f "$EXTRACTED_TXT"
