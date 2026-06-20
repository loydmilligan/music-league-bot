#!/usr/bin/env bash
# mlb-run — kick off the round-transition-agent
#
# Usage:
#   mlb-run --round ROUND_ID [--league LEAGUE_ID] [--chat FILE_OR_TEXT]
#
# --chat can be:
#   a file path   → parses it, filters to the round's date window (submission → voting + 3 days)
#   quoted text   → used verbatim
#   omitted       → no chat content (section will be skipped or left minimal)
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

# -- Handle chat input --
CHAT_CONTENT="none"

if [ -n "$CHAT_INPUT" ]; then
  if [ -f "$CHAT_INPUT" ]; then
    echo "Chat: filtering $CHAT_INPUT to round date window..."
    CHAT_CONTENT=$(python3 << PYEOF
import re, sys
from datetime import datetime, timedelta

# Parse round date window: sub_deadline - 1 day through vote_deadline + 3 days
sub_str = """$SUB_DEADLINE"""
vote_str = """$VOTE_DEADLINE"""

def parse_round_date(s):
    for fmt in ('%Y-%m-%dT%H:%M:%S', '%Y-%m-%d'):
        try: return datetime.strptime(s[:len(fmt)], fmt)
        except: pass
    return None

window_start = parse_round_date(sub_str) - timedelta(days=1) if parse_round_date(sub_str) else None
window_end   = parse_round_date(vote_str) + timedelta(days=3) if parse_round_date(vote_str) else None

# WhatsApp line format: M/DD/YY, H:MM AM/PM - ...
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
        elif not window_start:  # no dates known — include everything
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
