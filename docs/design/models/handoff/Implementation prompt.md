# Implementation prompt — Models & AI screen

You're adding the **Models & AI** screen to the music-league-bot webapp
(SvelteKit + Tailwind v4, already on the Mash Co. dark design system). It
is the OpenRouter key + model manager: save a roster of models by pasting
their OpenRouter id and looking up their spec, then let every AI job in the
bot pick from the models that qualify for it.

A working, interactive visual reference lives at
`reference/Music League Bot - Models.html`. Open it in a browser. The
**first artboard** is the live target — build to match it. The **second
artboard** shows the lookup panel frozen in its resolved state.

This is a new screen on an existing app — do **not** restructure the
surrounding chrome (sidebar, header). Drop the screen into the existing
layout and add one sidebar nav entry.

---

## 0. Read these first

| File | Why |
|---|---|
| `reference/Music League Bot - Models.html` | Open in browser — the visual + interactive target. |
| `reference/ml-models.jsx` | React reference for every component + all the logic (lookup, cost-tier, qualify). Translate to Svelte. |
| `reference/ml-models.css` | CSS classes. Lift wholesale — class names start with `.mlm-`. |
| `reference/ml-shared.jsx` | The `Sidebar` atom — the new nav entry goes in the `navs` array (`{ id: "models", glyph: "✦", label: "Models & AI", tail: "6" }`). |
| `colors_and_type.css` (already in your repo) | All `--mash-pulp`, `--ink-*`, `--moss/--amber/--ember/--sky` tokens. |

---

## 1. Files to add to the music-league-bot repo

| From (this folder) | To (your repo) | Why |
|---|---|---|
| `reference/ml-models.css` | `src/lib/models/models.css` (or scoped into the route component) | All `.mlm-*` classes — no changes needed |
| `reference/*` (everything else) | `docs/design/models/` | Keep as reference; do not serve |

The CSS is **self-contained** — it consumes Mash Co. tokens plus the
shared `.ml-card`, `.ml-input`, `.ml-chip`, `.ml-icon-btn`, `.mash-btn`,
`.t-eyebrow` primitives already in your app from earlier handoffs. No new
dependencies.

---

## 2. The data model

A saved model record. This is the whole schema — there's no more to it:

```sql
CREATE TABLE ai_models (
  id            TEXT PRIMARY KEY,            -- internal uuid
  model_id      TEXT NOT NULL UNIQUE,        -- OpenRouter id, e.g. "anthropic/claude-sonnet-4"
  nickname      TEXT NOT NULL,               -- display name
  description   TEXT NOT NULL DEFAULT '',
  model_type    TEXT NOT NULL DEFAULT 'general',  -- general | reasoning | coding | image
  context_len   INTEGER,                     -- tokens
  price_in      REAL,                        -- $ per 1M input tokens
  price_out     REAL,                        -- $ per 1M output tokens
  is_free       INTEGER NOT NULL DEFAULT 0,  -- separate flag, NOT a cost tier
  cost_override TEXT,                        -- null | '$' | '$$' | '$$$'  (manual tier override)

  -- capabilities (auto-detected at lookup, user-correctable)
  cap_reason    INTEGER NOT NULL DEFAULT 0,  -- deep reasoning / extended thinking
  cap_stream    INTEGER NOT NULL DEFAULT 1,  -- streaming
  cap_vision    INTEGER NOT NULL DEFAULT 0,  -- image input
  cap_tools     INTEGER NOT NULL DEFAULT 0,  -- tool / function calling
  cap_json      INTEGER NOT NULL DEFAULT 0,  -- structured JSON output

  favorite      INTEGER NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

And the per-task assignment — which saved model runs each AI job:

```sql
CREATE TABLE ai_task_assignments (
  task_id   TEXT PRIMARY KEY,   -- 'theme-fit' | 'chat-parse' | 'digest' | 'vibe' | 'art-read'
  model_id  TEXT REFERENCES ai_models(model_id) ON DELETE SET NULL
);
```

### The five capabilities — fixed order, fixed glyphs

Always render in this order. These are the visual contract:

| Key      | Label                    | Glyph | Short    |
|----------|--------------------------|-------|----------|
| `reason` | Deep reasoning           | `∴`   | reasoning|
| `stream` | Streaming                | `⇉`   | streaming|
| `vision` | Image input (vision)     | `◉`   | vision   |
| `tools`  | Tool / function calling  | `ƒ`   | tools    |
| `json`   | Structured JSON output   | `{}`  | json     |

### Cost tier — derived, overridable, plus a separate FREE flag

```
effectivePrice = (price_in + price_out) / 2     // already in $/1M
tier = cost_override ?? (
  effectivePrice <  1  → '$'   (var(--moss),  green)
  effectivePrice < 10  → '$$'  (var(--amber), amber)
  else                 → '$$$' (var(--ember), red)
)
```

`is_free` is **separate**. A free model shows a green **FREE** badge and
**no** `$` tier. In the qualify check below, free counts as cheaper than
`$` (effective cost 0).

---

## 3. Page anatomy

Stack, top to bottom, inside the existing `<main class="ml-main ml-main--narrow">` column:

1. **Page head** — eyebrow (`Models & AI · OpenRouter`), `<h1>Models</h1>`, sub-paragraph.
2. **Card: OpenRouter connection** (`.ml-card`) — key field + default-model picker.
3. **Card: Saved models** (`.ml-card`) — the roster table + the add/lookup panel.
4. **Card: Task assignments** (`.ml-card ml-card--accent`) — one row per AI task.

### 3a. OpenRouter connection card

- Header: title + sub, with a right-aligned status pill (`.mlm-status`):
  `Configured` (moss + dot) when a key is set, `Required` (amber + dot)
  when empty.
- Two-column grid (`.mlm-keybar`, collapses to 1 col under 920px):
  - **API key** — `.mlm-key-field`: a password `.ml-input` with a
    `show/hide` reveal button (`.mlm-reveal`) absolutely positioned at the
    right. Hint underneath: `Get a key at openrouter.ai/keys ↗`.
  - **Default model** — a styled native `<select>` (`.mlm-select`) listing
    every saved model by nickname, favorites first. Hint: "Used by any task
    without an explicit pick below."

### 3b. Saved models card

Header: `Saved models · {count}` + sub ("Star a model to float it to the
top of every picker.").

**Roster table** (`.mlm-list`) — a header row (`.mlm-list-head`) then one
`.mlm-row` per model. Grid columns:
`24px 32px minmax(0,1fr) 150px 50px 60px` =

| Slot | Content |
|------|---------|
| 1 | **Star** button (`.mlm-star`, `★/☆`) — toggles favorite, amber when on |
| 2 | **Provider badge** (`.mlm-prov`) — 32×32, mono 2-letter abbreviation of `model_id.split('/')[0]` (anthropic→AN, openai→AI, google→GG, deepseek→DS, meta-llama→ML, x-ai→XAI) |
| 3 | **Name block** — nickname (600 14px) + a `.mlm-type` chip (the model_type), then a mono id line with `{context/1000}k ctx` appended in muted |
| 4 | **Capabilities** (`.mlm-caps`) — the five glyph cells in fixed order; supported = full, unsupported = `.is-off` (opacity .2) |
| 5 | **Cost** — `$`/`$$`/`$$$` colored (moss/amber/ember) OR the green **FREE** badge |
| 6 | **Actions** — `.ml-icon-btn` edit (`✎`, loads the model back into the add panel as a draft) + remove (`×`, ember) |

Rows sort favorites-first. Hover → `--surface-hover`.

**Add / lookup panel** (`.mlm-add`, dashed border; solid `.is-resolved`
once a draft exists) — see §4.

### 3c. Task assignments card

`.ml-card--accent` (pulp left border). Header sub: "Each job the bot does
declares the properties a model must have. The picker only offers models
that qualify."

One `.mlm-task` per task (grid `1fr 300px`, collapses under 860px):

- **Left (`.mlm-task-info`)**: task name with a 2-letter `.mlm-task-glyph`
  tile, a description paragraph, and a **requires** row (`.mlm-reqs`): one
  `.ml-chip.ml-chip--sky` per required capability (glyph + label) plus, if
  there's a cost cap, one `.ml-chip.ml-chip--amber` reading `≤ $$`.
- **Right (`.mlm-task-pick`)**: an "Assigned model" `.mlm-select` whose
  options are **only the qualifying models**, and a `.mlm-qual` line:
  `<b>N</b> of M models qualify` (the `b` turns ember via `.is-none` when
  zero qualify).

---

## 4. The lookup flow (the core feature)

In the add panel:

1. A text `.ml-input` + a **Look up** button (`.mash-btn--secondary`).
   Paste an OpenRouter id (`anthropic/claude-sonnet-4`). `Enter` also fires.
2. On click: button shows a spinner (`.mlm-spin`) + "Looking up". Fetch
   `GET https://openrouter.ai/api/v1/models`, find `data.find(m => m.id === pasted)`.
   - **Not found** → red `.mlm-lookup-err`: "No model with that id."
   - **Found** → populate an editable **draft** from the API row:

   | Draft field | From OpenRouter response |
   |---|---|
   | nickname | `name` (fallback: id after the `/`) |
   | context_len | `context_length` ?? `top_provider.context_length` |
   | price_in / price_out | `pricing.prompt * 1e6`, `pricing.completion * 1e6` |
   | is_free | both prices are 0 (or id ends `:free`) |
   | cap_vision | `architecture.modality` includes `image` |
   | cap_reason | id matches `/o1|o3|r1|reason|think/i` |
   | cap_stream/tools/json | default true / best-guess (let the user correct) |
   | model_type | `reasoning` if cap_reason, else `general` |

3. The resolved draft renders (`.mlm-autofill`):
   - A `.mlm-resolved-bar`: a moss "Resolved" pill, `provider · {ctx}k
     context`, and `${in}/M in · ${out}/M out → $$` (or "free tier"). If
     the id wasn't in the catalog and you fabricated a spec, show an amber
     "· estimated" note.
   - Editable **Nickname** input and **Type** select.
   - **Capabilities** as toggle chips (full-width row) — click to flip each
     `cap_*`. This is where the user corrects a bad auto-detect.
   - **Save model** (primary) appends/updates the roster (dedupe on
     `model_id`); **Cancel** clears the draft.

The reference mocks the fetch against a small `CATALOG` and fabricates a
plausible spec for unknown ids so the flow never dead-ends — in production,
wire the real endpoint and keep a graceful "estimated" fallback if the id
isn't in the returned list.

---

## 5. The qualify check (drives task pickers)

```js
const CAP_ORDER = ["reason", "stream", "vision", "tools", "json"];

function effCost(m) { return m.is_free ? 0 : ({ "$":1, "$$":2, "$$$":3 }[tierOf(m)] || 3); }

function qualifies(model, req) {
  for (const c of CAP_ORDER) if (req[c] && !model["cap_" + c]) return false;
  if (req.maxCost && effCost(model) > req.maxCost) return false;  // maxCost is 1|2|3
  return true;
}
```

A task's picker lists `models.filter(m => qualifies(m, task.req))`,
favorites first. If the currently-assigned model no longer qualifies (its
spec changed), show a disabled "Pick a qualifying model…" placeholder
until the user reselects.

### The five tasks (CONFIRM with the owner before shipping)

These requirement rules are a best guess at what the bot runs. The screen
is driven entirely by this array — edit it freely.

| Task id | Name | Requires |
|---|---|---|
| `theme-fit` | Theme-fit scoring | `json`, `reason`, `≤ $$` |
| `chat-parse` | Chat parsing | `json`, `tools`, `≤ $` |
| `digest` | Digest writing | `stream`, `≤ $$` |
| `vibe` | Vibe clustering | `reason`, `json` |
| `art-read` | Cover-art read | `vision`, `≤ $$` |

---

## 6. API surface

```
GET    /api/models                       — list saved models (favorites first)
POST   /api/models                       — body: full record — add (dedupe on model_id)
PATCH  /api/models/:id                   — partial update (nickname, caps, cost_override, favorite…)
DELETE /api/models/:id                   — remove
GET    /api/models/lookup?id=...          — server-side proxy of OpenRouter /models (avoids any
                                            CORS surprises + lets you cache the catalog ~1h)
GET    /api/models/assignments            — { task_id: model_id }
PUT    /api/models/assignments/:task_id   — body: { model_id }

GET    /api/settings/openrouter-key       — masked status (configured?)
PUT    /api/settings/openrouter-key       — body: { key }  (store server-side, never echo back raw)
```

The OpenRouter **catalog** endpoint (`/api/v1/models`) needs no auth. The
saved **key** is only used when the bot actually calls a model for a task.

---

## 7. Things to AVOID

- **Don't** make FREE a fourth cost tier. It's a separate boolean badge; a
  free model shows FREE and no `$`.
- **Don't** drop the manual cost override. Auto-derived tier is the
  default, but the user must be able to pin a model to `$`/`$$`/`$$$`.
- **Don't** let a task picker offer a model that fails its requirements.
  The filter is the whole point of the screen.
- **Don't** auto-detect capabilities and then lock them. The toggle chips
  in the add panel must remain editable before save.
- **Don't** use stock Tailwind palette colors. One accent (pulp) + four
  states (moss/amber/ember/sky) + the neutral `--ink-*` scale. The cost
  tiers are moss/amber/ember in that order.
- **Don't** add emoji. The glyphs are functional Unicode (`∴ ⇉ ◉ ƒ {} ★ ☆
  ✎ × ↻ ↗`), not emoji.
- **Don't** render the `m/l` sidebar mark as flat italic — chunky extruded
  recipe only (`.ml-brand-mark`).
- **Don't** store the OpenRouter key in any client-readable place that the
  chat ingest or logs can reach. Server-side, masked in the UI.

---

## 8. Definition of done

- [ ] Models & AI route renders inside the existing app shell (sidebar +
  main column). Sidebar has a "Models & AI" entry (glyph `✦`) that's active.
- [ ] OpenRouter connection card: masked key field with show/hide, a
  Configured/Required status pill, and a default-model picker.
- [ ] Saved-models roster: star/favorite (floats to top), provider badge,
  nickname + type + id + context, the five capability glyphs in fixed
  order, cost tier or FREE badge, edit + remove actions.
- [ ] Add panel: paste an id → Look up (spinner) → real OpenRouter fetch →
  auto-filled, editable draft (nickname, type, capability toggle chips) →
  Save dedupes into the roster. Not-found and estimated states handled.
- [ ] Cost tier auto-derives from pricing and is manually overridable;
  FREE is a separate badge.
- [ ] Task assignments: each task shows its required-property chips and a
  picker limited to qualifying models, with a live "N of M qualify" count.
  Changing a model's caps re-filters every task picker.
- [ ] Key stored server-side, masked in UI. Assignments persist.
- [ ] No console errors. `npm run check` passes. No raw hex literals.

When done, open `reference/Music League Bot - Models.html` side-by-side and
compare to both artboards — the live main view and the resolved-lookup state.
