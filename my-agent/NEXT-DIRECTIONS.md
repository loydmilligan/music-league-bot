# Next Directions

Planned version sequence for round-transition-agent.

---

## v1 — Automated sharing (WhatsApp + GChat)

**What:** Agent sends the digest link directly to each league's chat rather than outputting a message for you to paste.

**Why deferred:** WhatsApp Business API requires an approved app + webhook token; GChat needs an incoming webhook URL. Neither credential was on hand during v0 build.

**How:**
- WhatsApp: register a WhatsApp Business app → get a Phone Number ID + Access Token → store in a CMA vault credential (`environment_variable`, `secret_name: WHATSAPP_TOKEN`) → agent calls `POST https://graph.facebook.com/v18.0/{PHONE_ID}/messages` with the sharing message. Gate with `always_ask` on the vault tool so you confirm before send. Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/messages/text-messages
- GChat: create an incoming webhook in the target Space (Space Settings → Apps & integrations → Webhooks) → store the URL in a vault env var → agent calls `POST {WEBHOOK_URL}` with `{ "text": "..." }`. No OAuth needed — it's a static URL. Docs: https://developers.google.com/workspace/chat/create-messages#create_a_webhook

---

## v2 — Scheduled polling + chat content automation

**What:** A CMA deployment polls periodically for rounds where all votes are in, triggers the pipeline automatically without a manual kickoff. Also: automated ingestion of WhatsApp and GChat messages (replacing the manual paste step).

**Why deferred:** Round endings are currently detected manually; a polling deployment is straightforward but the reliability of detecting "all votes in" needs verification. WhatsApp bot auth was previously unreliable; GChat ingestion hasn't been attempted yet.

**How:**
- Scheduled deployment: `POST /v1/deployments?beta=true` with `schedule: { type: "cron", expression: "0 * * * *", timezone: "America/New_York" }` — hourly poll. Agent checks `GET /api/active-rounds` for rounds with `voting_deadline` in the past, then runs the pipeline if the round isn't already complete.
- WhatsApp ingestion: fix the WhatsApp bot token refresh issue (re-auth flow or longer-lived token); store in vault; agent calls the Messages API to fetch recent messages in the date window.
- GChat ingestion: use Google Chat API (`spaces.messages.list` with a time filter). Requires a service account with Space membership. Docs: https://developers.google.com/workspace/chat/list-messages

---

## v3 — Archive generation automation

**What:** Agent generates and distributes the season archive (player profiles, full-season digest) as part of the round transition, or on a separate trigger at season end.

**Why deferred:** Archive content quality improvements are planned first; it's also only sent a few times per season so the manual trigger is acceptable for now.

**How:**
- The archive API surface already exists in the app. Once content is stable, add archive generation as an optional STEP 9 in the pipeline (triggered by a flag in the input, e.g. `"generateArchive": true`).

---

## always — Re-run evals before promoting a new agent version

Before bumping the agent to a new version in production, run the held-back eval cases:

```bash
# from my-agent/
bash evals/run-evals.sh
```

Promote only when all verdicts hold. Save the passing run's output as the new baseline.
