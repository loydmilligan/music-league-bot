# Models & AI screen — handoff package

This package adds the **Models & AI** screen to the music-league-bot
webapp. It is the OpenRouter key + model manager, ported in spirit from
the old `music-league-strategist` app's `ModelsManager`.

Like the other recent handoffs in this project, this is a **single-screen
addition** to the existing app. Don't restructure the chrome — drop the
new screen + CSS in, add one sidebar entry, and wire the routes.

The old app's architecture does **not** carry over (it was React + Zustand;
music-league-bot is SvelteKit). Nothing here depends on it. The whole
feature is: one API key + a flat list of model records + a per-task
requirement object. That maps onto whatever store the bot already uses.

## What's in this folder

```
models-handoff/
├── README.md                          ← you are here
├── handoff/
│   └── Implementation prompt.md       ← paste this into Claude Code
└── reference/
    ├── Music League Bot - Models.html      ← open in browser — visual + interactive target
    ├── ml-models.jsx                       ← React reference; translate to Svelte
    ├── ml-models.css                       ← LIFT WHOLESALE — copy into your repo
    ├── ml-shared.jsx                       ← Sidebar atom (the nav entry goes here)
    ├── ml-data.jsx                         ← surrounding-app data (reference)
    ├── ml-styles.css                       ← base music-league-bot styles (reference)
    ├── colors_and_type.css                 ← tokens — already in your repo
    ├── orc-tower-styles.css                ← sibling kit styles (.mash-btn lives here)
    └── design-canvas.jsx                   ← only used to render the reference HTML
```

## Where each file goes in the music-league-bot repo

| From here | To your repo |
|---|---|
| `reference/ml-models.css` | `src/lib/models/models.css` (or scoped into the route component) — the only file you HAVE to copy |
| `reference/*` (everything else) | `docs/design/models/` — keep as reference, do not serve |

The CSS is self-contained — it only references Mash Co. tokens (`--ink-*`,
`--mash-pulp`, `--moss/--amber/--ember/--sky`) already in your `tokens.css`,
plus the `.ml-card`, `.ml-input`, `.ml-chip`, `.ml-icon-btn` primitives and
`.mash-btn` (from `ml-styles.css` / `orc-tower-styles.css`, already in your
app from earlier handoffs).

## What to do

1. Drop `ml-models.css` into your repo where the models-screen CSS belongs.
2. Drop the other reference files into `docs/design/models/`.
3. Open `reference/Music League Bot - Models.html` in a browser. The
   **first artboard** is the live target — paste a model id (try
   `anthropic/claude-opus-4` or `deepseek/deepseek-r1`), press **Look up**,
   and watch it auto-fill. Star a model. Change a saved model's
   capabilities and watch the task "N of 6 qualify" counts move. The
   **second artboard** freezes the lookup in its resolved/auto-filled state
   so you can see every field.
4. Paste `handoff/Implementation prompt.md` into Claude Code, along with:
   *"read the files I just added to docs/design/models/ before you start,
   especially ml-models.css and ml-models.jsx."*

The prompt is structured around the data model + component specs + a
definition of done, not a step-by-step. Claude Code should translate the
React reference to Svelte in one focused pass.

## The one thing that matters most

The headline interaction is **task → required properties → matching
models**. Every AI job the bot runs declares a small requirement object
(needs reasoning? needs json? cost cap?). The model picker for that task
**only offers models that satisfy it**, and shows a live "N of M qualify"
count. This is what makes the roster useful instead of decorative —
get this right even if you trim everything else.

## Notes for Claude Code

- The `$ / $$ / $$$` cost tier is **auto-derived from pricing** (avg of
  in/out per 1M tokens: `<$1` → `$`, `<$10` → `$$`, else `$$$`) but must be
  **manually overridable** per model. A model priced at `$0/$0` gets a
  separate green **FREE** badge instead of a `$` tier — free is its own
  flag, not a fourth tier.
- The lookup hits the **public** OpenRouter models endpoint:
  `GET https://openrouter.ai/api/v1/models` → find the row where
  `id === pastedId`. No auth needed for the catalog (the saved key is only
  for actually *calling* models). The reference mocks this against a small
  catalog + a fabricated fallback; wire it to the real endpoint.
- Capabilities are **auto-detected** from the API response but rendered as
  **editable toggle chips** in the add panel — the detection is a
  best-guess (e.g. `architecture.modality` includes `image` → vision;
  id matches `o1|o3|r1|reason` → reasoning). Let the user correct it.
- The five AI tasks in the reference (`theme-fit`, `chat-parse`, `digest`,
  `vibe`, `art-read`) and their requirement rules are **a best guess** at
  what the bot runs. Confirm the real task list with the owner and adjust
  `AI_TASKS` — the screen is driven entirely by that array.
- No emoji. The capability glyphs are functional Unicode (`∴ ⇉ ◉ ƒ {}`),
  the star is `★/☆`, actions are `✎ ×`. Keep them.
- Don't render the `m/l` sidebar mark as flat italic — use the chunky
  extruded recipe (`.ml-brand-mark`, the 3-step text-shadow + stroke).
