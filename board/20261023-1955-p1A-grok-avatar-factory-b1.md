# p1A Avatar Factory — BUGFIX B1 (on A6 `d6d68ad` / board `8251418`)

- Branch: `lane/grok-avatar-factory`
- **Deploy SHA: `73382a8`** (on top of A6 `d6d68ad`)
- Tests: `cd ui && npm test -- --run src/lib/server/avatarFactory` → **55 passed / 15 files**
- No merge, no push, no rebuild. No live OpenRouter / Runway / fal / Grok calls. New dep: `sharp ^0.35.5` (native; Herdwick image rebuild will compile it).

## (a) Path that produced Mashew's "openrouter rejected"

There is **no** `"openrouter rejected"` string in factory UI or server. Pre-B1 generate:

1. `generateOpenRouterImage` threw `OpenRouter image <status>: <body>` on HTTP `!ok`, or `OpenRouter returned no image` on **200 with empty `choices[0].message.images`**.
2. `+server.ts` `fail()` mapped paused→503, locked/invalid/confirm→400, **else 500 with the raw message**.
3. UI `post()` showed `j.message`. Mashew's phrase is a paraphrase of that 500.

Ronnie-specific with the same Simpsons inspiration as others who succeeded, and a current photo of **245×700 RGBA PNG** (earlier 512² RGB PNG and 1200×1600 progressive JPEG), points at the input image. Without provider logs we cannot tell HTTP `!ok` vs 200-with-no-image. Most likely **200-with-no-image** (Gemini safety/likeness, text-only) or HTTP 400 bad image. B1 logs the distinction.

## What shipped

- Server `console.error` one-line JSON: provider, model, HTTP status, provider error code+message, finish_reason / native_finish_reason, text snippet ≤200, generation id, payload bytes, reference filenames + dimensions. Never keys or base64.
- `lastError` `{at, provider, model, status, reason, message}` on the member (generate/tweak) or league (group shot) in `state.json`.
- Every input image normalized before send: EXIF-rotate, flatten alpha onto white, longest side ≤1024, baseline JPEG q≈90.
- 200-with-no-image is typed `no_image` → UI **"Safety/likeness refusal by the model"** (+ model text snippet). 402 **"Out of credits (402)"**, 400 **"Bad input image"**, 429 **"Rate limited"**. HTTP 422 for refusals, 402/429/400 as matching.
- Failed attempts do **not** add `costUsd`. If OpenRouter `usage.cost` is present on a refusal, it is `failedCostUsd` in totals (shown, not hidden).
- **No auto-retry**: first letter failure stops remaining A/B/C; successful letters already written stay.

READY FOR DEPLOY
