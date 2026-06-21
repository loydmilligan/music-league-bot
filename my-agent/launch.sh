#!/usr/bin/env bash
set -euo pipefail
# Round Transition Agent — launch script
# Run from: /home/loydmilligan/Projects/music-league-bot/my-agent/

cd "$(dirname "$0")"

# 0. Load credentials
set -a; source .env; set +a
[ -f IDS.env ] && { set -a; source IDS.env; set +a; } || true

BASE=https://api.anthropic.com/v1
H=(-H "x-api-key: $ANTHROPIC_API_KEY"
   -H "anthropic-version: 2023-06-01"
   -H "anthropic-beta: managed-agents-2026-04-01"
   -H "content-type: application/json")

CURRENT_MODEL=$(python3 -c "import json; m=json.load(open('agent.json'))['model']; print(m['id'] if isinstance(m,dict) else m)")
echo "Using model: $CURRENT_MODEL"

# 2. Create environment (skip if ENV_ID already in IDS.env)
if [ -z "${ENV_ID:-}" ]; then
  echo ""
  echo "Creating environment..."
  curl -sS --fail-with-body "$BASE/environments" "${H[@]}" \
    -d @environment.json -o /tmp/env.json
  ENV_ID=$(python3 -c "import json; d=json.JSONDecoder(strict=False).decode(open('/tmp/env.json').read()); print(d['id'])")
  echo "ENV_ID=$ENV_ID" >> IDS.env
  echo "✅ 📦 environment $ENV_ID"
else
  echo "↩️  📦 reusing environment $ENV_ID"
fi

# 3. Create agent (skip if AGENT_ID already in IDS.env)
if [ -z "${AGENT_ID:-}" ]; then
  echo ""
  echo "Creating agent..."
  curl -sS --fail-with-body "$BASE/agents" "${H[@]}" \
    -d @agent.json -o /tmp/agent_resp.json
  AGENT_ID=$(python3 -c "import json; d=json.JSONDecoder(strict=False).decode(open('/tmp/agent_resp.json').read()); print(d['id'])")
  AGENT_VERSION=$(python3 -c "import json; d=json.JSONDecoder(strict=False).decode(open('/tmp/agent_resp.json').read()); print(d['version'])")
  grep -v '^AGENT_ID\|^AGENT_VERSION' IDS.env > /tmp/ids_tmp.env 2>/dev/null || true
  echo "AGENT_ID=$AGENT_ID" >> IDS.env
  echo "AGENT_VERSION=$AGENT_VERSION" >> IDS.env
  echo "✅ 🤖 agent $AGENT_ID (v$AGENT_VERSION, model: $CURRENT_MODEL)"
else
  echo "↩️  🤖 reusing agent $AGENT_ID v${AGENT_VERSION:-?}"
fi

# 4. Create session
echo ""
echo "Creating session..."
curl -sS --fail-with-body "$BASE/sessions" "${H[@]}" \
  -d "{\"agent\": \"$AGENT_ID\", \"environment_id\": \"$ENV_ID\", \"title\": \"round-transition\"}" \
  -o /tmp/session.json
SESSION_ID=$(python3 -c "import json; d=json.JSONDecoder(strict=False).decode(open('/tmp/session.json').read()); print(d['id'])")
# Append session ID (keep history)
echo "SESSION_ID=$SESSION_ID" >> IDS.env
echo "✅ ▶️  session $SESSION_ID"
echo "   Watch live: https://platform.claude.com/workspaces/default/sessions/$SESSION_ID"

# 5. Send outcome kickoff
echo ""
echo "Sending kickoff..."
EVT=$(python3 -c "
import json
task = open('first_prompt.txt').read()
rubric = open('outcome.md').read()
evt = {'type':'user.define_outcome','description':task,'rubric':{'type':'text','content':rubric},'max_iterations':15}
print(json.dumps(evt))
")
curl -sS --fail-with-body "$BASE/sessions/$SESSION_ID/events" "${H[@]}" \
  -d "{\"events\":[$EVT]}" -o /tmp/kickoff_resp.json
echo "✅ 🎯 kickoff sent — agent is running (may take 3-10 minutes)"

# 6. Poll for completion
echo ""
echo "Polling every 30s..."
while true; do
  sleep 30
  curl -sS "$BASE/sessions/$SESSION_ID" "${H[@]}" -o /tmp/sess.json
  STATUS=$(python3 -c "import json; d=json.JSONDecoder(strict=False).decode(open('/tmp/sess.json').read()); print(d['status'])")
  if [ "$STATUS" = "idle" ]; then
    echo ""
    STOP=$(python3 -c "
import json
d=json.JSONDecoder(strict=False).decode(open('/tmp/sess.json').read())
sr=d.get('stop_reason')
print(sr.get('type','unknown') if isinstance(sr,dict) else str(sr))
")
    VERDICTS=$(python3 -c "
import json
d=json.JSONDecoder(strict=False).decode(open('/tmp/sess.json').read())
evals=d.get('outcome_evaluations',[])
for e in evals:
    print(' ', e.get('result'), '-', (e.get('explanation') or '')[:80])
")
    echo "Run complete — stop_reason: $STOP"
    echo "Outcome:"
    echo "$VERDICTS"
    echo ""
    echo "Fetch output files:"
    echo "  curl -sS \"$BASE/files?scope_id=$SESSION_ID\" \"\${H[@]}\" | python3 -c \"import json,sys; d=json.load(sys.stdin); [print(f['id'], f['filename']) for f in d['data']]\""
    break
  else
    echo "  status=$STATUS — waiting..."
  fi
done
