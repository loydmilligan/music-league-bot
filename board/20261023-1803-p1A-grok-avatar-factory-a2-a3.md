# p1A Avatar Factory — ADDENDUM 2 + 3 (on master `d4b49d0`)

- Branch: `lane/grok-avatar-factory` rebased onto master `d4b49d0`
- ADDENDUM 2 SHA: `b91de2a` (Conor C2 + SP contact sheet v2 + Simpsons plate v2, copy-only rescan)
- ADDENDUM 3 SHA: `632aeca` (provider picker)
- Tests: `cd ui && npm test -- --run src/lib/server/avatarFactory` → **31 passed / 10 files**
- No merge, no push, no rebuild. No OpenRouter or other provider calls. No `.env` / compose `=0`. No force on shared branches.

## Picker

OpenRouter (Gemini) is the default and flagged **paused**. Grok / Runway / fal.ai are listed: **needs key** if the env var is absent, **disabled pending Mashew OK** if a key is present. Presence check only (`!!process.env.X`); values never printed. Nothing else is enabled for generation. Generated candidates record provider, model, and cost.

READY FOR DEPLOY
