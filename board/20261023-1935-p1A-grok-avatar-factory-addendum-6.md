# p1A Avatar Factory — ADDENDUM 6 (on master `d481080`)

- Branch: `lane/grok-avatar-factory` fast-forwarded to master `d481080`
- **Deploy SHA: `d6d68ad`**
- Tests: `cd ui && npm test -- --run src/lib/server/avatarFactory` → **45 passed / 13 files**
- No merge, no push, no rebuild. No live OpenRouter / Runway / fal / Grok calls. No `.env` / compose edits. Keys presence-checked only (`!!process.env.X`).

## Enabled providers

| Provider | Model | Estimate | Pricing basis / source |
| --- | --- | --- | --- |
| OpenRouter | `google/gemini-2.5-flash-image` | ~$0.04 | `usage.cost` when present; else labeled estimate |
| Runway | `gen4_image` (720p `1024:1024`; group `1360:768`) | **$0.05** | 5 credits × $0.01. https://docs.dev.runwayml.com/guides/pricing/ |
| fal.ai | `fal-ai/nano-banana/edit` | **$0.0398** | https://fal.ai/models/fal-ai/nano-banana/edit and https://fal.ai/pricing |
| Grok | listed | — | **disabled** (no xAI key; no Grok Imagine / `grok_imagine_image_2`) |

Runway env: `RUNWAY_API_SECRET` preferred, `RUNWAYML_API_SECRET` fallback. fal: `FAL_KEY`.

Same click + confirm (provider, model, image count, estimated cost) + POST `confirmed: true`. Kill switch `AVATAR_FACTORY_OPENROUTER_PAUSED=1` or `AVATAR_FACTORY_GEN_PAUSED=1` pauses **all** providers.

READY FOR DEPLOY
