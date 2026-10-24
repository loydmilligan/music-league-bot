# p1A Avatar Factory — ADDENDUM 5 (on master `d4b49d0`)

- Branch: `lane/grok-avatar-factory`
- **Deploy SHA: `f9f2749`** (ADDENDUM 5; includes A2 `b91de2a` + A3 `632aeca`)
- Tests: `cd ui && npm test -- --run src/lib/server/avatarFactory` → **36 passed / 11 files**
- No merge, no push, no rebuild. No OpenRouter or other provider calls. No `.env` / compose edits.

## v1.1 (ADDENDUM 5)

OpenRouter is **on by default**. Kill switch: `AVATAR_FACTORY_OPENROUTER_PAUSED=1` or `true` pauses; unset / `0` stays enabled. Generate / tweak / group-shot run only after a UI confirm dialog (image count + estimated cost) and POST `confirmed: true`. Cancel and pause make no fetch.

Per-image: provider, model, actual `usage.cost` or labeled estimate. Totals per theme / league / overall (actual vs estimated). Imported seed: `imported, $0`.

Each candidate: 1–5 rating + comment. Liked (≥4) and fix (≤2) comments go into the next generate/tweak prompt; the generated candidate shows `usedNotes`. Grok / Runway / fal.ai stay disabled.

READY FOR DEPLOY
