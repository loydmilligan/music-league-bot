# p1A Avatar Factory — ADDENDUM 4 pause (FIRST)

- Branch: `lane/grok-avatar-factory` (on top of v1 `817e241`)
- SHA: `2b0c50d`
- Tests: `cd ui && npm test -- --run src/lib/server/avatarFactory` → **25 passed / 9 files**
- No merge, no push, no rebuild. No OpenRouter calls from this agent. No `.env` / compose `=0`.

## Pause

Generate / Tweak / Group-shot are blocked server-side unless `AVATAR_FACTORY_OPENROUTER_PAUSED=0`. Unset or any other value = paused. Response message: **OpenRouter image gen paused**. Mock fetch is not called. UI disables those three buttons and shows a paused notice. Browse, rate, approve, Rescan (copy-only) still work.

READY FOR DEPLOY
