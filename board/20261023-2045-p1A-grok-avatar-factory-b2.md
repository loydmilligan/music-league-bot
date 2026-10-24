# p1A Avatar Factory — BUGFIX B2 (on B1 `73382a8`)

- Branch: `lane/grok-avatar-factory`
- **Deploy SHA: `21ce483`** (B1 `73382a8` remains in history)
- Tests: `cd ui && npm test -- --run src/lib/server/avatarFactory` → **63 passed / 16 files**
- No merge, no push, no rebuild. No live OpenRouter / Runway / fal / Grok calls.

## Fix

Group shot was sending all 11 approved avatars as separate reference images. Now:

- Server composites approved avatars into **one labeled JPEG sheet** (`sheet.ts`, sharp): ~256px tiles, name under each, **short → tallest** (Clements last), plain background.
- Sheet is versioned under `data/avatar-factory/images/<league>/<theme>/group/<stamp>-sheet.jpg` (`lastSheetRel` / `sheetRel`) and shown in the UI next to the group-shot result.
- Provider request gets that **single** image (longest side ≤1536, baseline JPEG) plus height notes in the prompt.
- **180s** `AbortController` (`GROUP_SHOT_TIMEOUT_MS`). Timeout is typed `Request timed out` (HTTP 504), logged as one JSON line (no keys/base64), `lastError` on the league, **no `costUsd`**, **no retry**. Sheet is kept as an input artifact even when the provider call fails.

B1 logging/normalization for per-member generate is unchanged.

READY FOR DEPLOY
