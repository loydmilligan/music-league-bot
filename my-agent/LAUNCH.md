# Round Transition Agent — Launch Guide

## Before first run

### 1. Fill in the league config in agent.json

Open `agent.json` and update the LEAGUE CHANNEL CONFIG section with your real league IDs and names.
Find the IDs from your app: `GET https://mlb37.mattmariani.com/api/active-rounds`

### 2. Set your Anthropic API key

Paste your key into `.env` (get it at platform.claude.com → API Keys):
```
ANTHROPIC_API_KEY=sk-ant-...
```
Note which workspace the key belongs to — every object created lands there and is only visible in that workspace's Console.

---

## Run a round transition

### 1. Edit first_prompt.txt

Fill in:
- League Name and League ID  
- Round ID (the round that just ended)
- Paste the WhatsApp/GChat chat content from the round period (or write "none")

### 2. Run launch.sh

```bash
cd /home/loydmilligan/Projects/music-league-bot/my-agent
bash launch.sh
```

The script:
1. Picks the model (first run: confirm the Opus-class ID, update agent.json)
2. Creates the environment and agent once (reuses them on subsequent runs)
3. Creates a session and sends the kickoff
4. Polls until complete, then prints the verdict

### 3. Fetch the output

```bash
set -a; source .env; source IDS.env; set +a
BASE=https://api.anthropic.com/v1
H=(-H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" \
   -H "anthropic-beta: managed-agents-2026-04-01")

# List output files
curl -sS "$BASE/files?scope_id=$SESSION_ID" "${H[@]}" | \
  python3 -c "import json,sys; d=json.load(sys.stdin); [print(f['id'], f['filename']) for f in d['data']]"

# Download sharing-ready.md (replace FILE_ID)
curl -sS "$BASE/files/FILE_ID/content" "${H[@]}" -o sharing-ready.md
cat sharing-ready.md
```

---

## Update the agent (new system prompt version)

```bash
set -a; source .env; source IDS.env; set +a
BASE=https://api.anthropic.com/v1
H=(-H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" \
   -H "anthropic-beta: managed-agents-2026-04-01" -H "content-type: application/json")

NEW_SYSTEM=$(python3 -c "import json; print(json.load(open('agent.json'))['system'])")
curl -sS --fail-with-body "$BASE/agents/$AGENT_ID" "${H[@]}" \
  -d "{\"version\": $AGENT_VERSION, \"system\": $(python3 -c "import json; print(json.dumps(json.load(open('agent.json'))['system'])")}" \
  -o /tmp/update.json
NEW_VERSION=$(python3 -c "import json; d=json.JSONDecoder(strict=False).decode(open('/tmp/update.json').read()); print(d['version'])")
sed -i "s/^AGENT_VERSION=.*/AGENT_VERSION=$NEW_VERSION/" IDS.env
echo "Agent updated to v$NEW_VERSION"
```

---

## Console links

- Agents list: https://platform.claude.com/workspaces/default/agents  
- Sessions list: https://platform.claude.com/workspaces/default/sessions  
  (replace "default" with your workspace slug if your key is in a non-default workspace)
