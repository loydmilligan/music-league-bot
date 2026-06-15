# Implementation prompt — Content screen (operator side of the b-side)

You're changing the **music-league-bot operator app** (`mlbot2.mattmariani.com`)
so the operator can publish and update each league's **b-side** — the
public, no-auth consumer site built in the `dashboard-handoff` package.
This package is **only the operator controls**; the public site is that
other package. Build both.

A working visual reference lives at
`reference/Music League Bot - Content Screen.html`. **Open it before you
start** and walk the four artboards (drag to pan; click an artboard label
to open it fullscreen).

The app is on the **dark Mash Co. design system** already. The CSS here
only references tokens in your `colors_and_type.css`.

---

## 0. Read these first

| File | Why |
|---|---|
| `reference/Music League Bot - Content Screen.html` | Open in a browser — the visual target, 4 artboards. |
| `reference/ml-content.jsx` | The whole screen: sidebar, tabs, archive list, update modal, reshare. |
| `reference/ml-content-styles.css` | Every `.ct-*` class + `.ml-nav-badge`. Lift wholesale. |
| `reference/ml-content-data.jsx` | League b-side state + the archive-update plan shape. |
| `reference/ml-digest-refine.jsx` | `PipelineStrip` + `RoundPicker` (reused by the Digest tab) and the regen-modal idiom the update modal echoes. |
| `colors_and_type.css`, `ml-styles.css`, `orc-tower-styles.css` (already in your repo) | Tokens, `.ml-app` shell, `.mash-btn`. |

**`design-canvas.jsx` is the review wrapper — do NOT ship it.** Each
`<ContentScreen>` is a real operator screen.

---

## 1. Files to drop into the repo

| From (this folder) | To (your repo) |
|---|---|
| `reference/ml-content-styles.css` | `src/lib/content/content.css` (or scoped to the route) |
| `reference/ml-content.jsx` | Port to your framework under the Content route |
| `reference/*` (everything else) | `docs/design/content/` — keep as reference, do not serve |

---

## 2. The nav change

The sidebar's `digest` item (glyph `✉`, label **"Digest preview"**) becomes
**"Content"**. It carries a **count badge** (`.ml-nav-badge`) equal to the
number of leagues with a pending archive update. Route: `/content` (keep a
redirect from the old `/digest` path).

---

## 3. The two tabs

Mash header-tab idiom (`.ct-tabs` / `.ct-tab`, the same recipe as the
`cda-tabs` surface switcher): pill group, `is-on` = pulp fill, a `.ct-count`
badge on the Archive tab.

| Tab | Content |
|---|---|
| **Digest** | The existing generate → refine → finalize pipeline, **unchanged**. The reference renders `RoundPicker` + `PipelineStrip` + the finalize actions as a compact stand-in — in your app this tab simply *is* the current digest screen. |
| **Archive** | The new b-side management surface (§4–§7). Count badge = pending updates. |

Finalizing a digest on the Digest tab is the **only** thing that makes a
round "available to add" on the Archive tab. The two tabs share the round
context.

---

## 4. Archive tab — the league list

One row per league (`.ct-league`). Each row has three states:

| State | Trigger | Visual | Primary action |
|---|---|---|---|
| **Update ready** | b-side exists AND a finalized digest is not yet archived | pulp-tinted row, pulsing "1 update ready" pill, pending-round line | **Update archive →** (opens the modal, §5) |
| **Up to date** | b-side exists, no new finalized digest | normal row, moss "✓ up to date" pill | View (disabled "No new digest") |
| **Not published** | no b-side yet | dashed row, "not published" pill | **Publish b-side →** (first publish, §6) |

Each row shows: league emblem, name, season pill, the **b-side URL with a
lock glyph** (`digest.mattmariani.com/{slug}`), and meta (members · rounds
archived · last updated). The intro line above the list states the core
rule: **one b-side per league, one link reused all season.**

---

## 5. Archive-update modal

Reuses the digest `.dg-modal` shell. Opens from "Update archive →".

**Header** — "Update b-side · {league}".
**Sub** — "Adding R-{n} — '{theme}' to the archive. Pick what recomputes."

**Section list** (`.ct-uplist`) — one row per piece of the b-side:

| Row | Kind | Control |
|---|---|---|
| **New archive entry** | `add` (required) | Fixed "timeline" label — always added, not optional. Links the new round's full digest into the archive timeline, newest first. |
| **Season superlatives** | `recompute` | refresh / hold / lock + "↻ steer this rewrite" |
| **Season stats · KPIs** | `recompute` | refresh / hold / lock |
| **Taste fingerprints** | `recompute` | refresh / hold / lock + steer |
| **Moments of the season** | `recompute` | refresh / hold / lock + steer |
| **Your people · overlap** | `recompute` | refresh / hold / lock (defaults to **hold** — one round rarely moves it) |

Each row shows a short **note** (what it is) and a **detail** (the concrete
change this round causes, e.g. "'Most divisive' moves to Theo"). This is
the operator's "should I refresh this?" signal.

**The refresh / hold / lock control** (`.ct-seg`):

| Value | Meaning | Persisted effect |
|---|---|---|
| `refresh` | recompute this section from the new round's data | section regenerates on Generate |
| `hold` | keep the current published version this round | section unchanged until a future refresh |
| `lock` | pin — never auto-updates, even on future rounds | section is operator-curated; future update modals default it to `lock` |

**Steerable** sections (the ones that generate prose — superlatives,
fingerprints, moments) expose a "↻ steer this rewrite" affordance that
opens the same quick-steer chips + free-text the digest regen modal uses
(`ARCHIVE_STEER_CHIPS`: warmer · less roast-y · more concise · celebrate,
don't rank · keep current winner). Tuned for the yearbook voice.

**Config strip** (`.ct-config`):
- **Announce** — `share card` / `link only` / `silent` (what the reshare
  step produces, §7).
- **Same-slug guarantee** — a locked, non-editable line: `🔒 same slug ·
  {slug}`. Reinforce that members keep their existing link.

**Footer** — token/cost estimate (scales with the number of refreshing
sections) on the left; Cancel + **Generate update →** on the right.

On **Generate**: the modal closes, the chosen sections recompute, the
existing b-side read-model is rewritten **in place on the same slug**, and
the screen flips to the published state (§7).

---

## 6. First publish (not-published leagues)

For a league with no b-side yet, the primary action is **Publish b-side →**.
This mints the league's **permanent unguessable slug** (≥ 80 bits — see the
b-side package §2) and generates the initial read-model from all archived
rounds at once. After the first publish, the same league uses the
update-modal flow (§5) for every subsequent round. The slug never changes
except on a deliberate rotation.

---

## 7. Published / reshare state

After Generate (or first publish):

- **Success banner** (`.ct-published`) — "b-side updated · Round {n} is live
  in the archive", with "{league} · published to {url} · same link as
  always".
- **Reshare card** (`.ct-reshare-card`) — a screenshot-ready announcement in
  the b-side's consumer voice: "the b/side · NEW IN THE ARCHIVE · Round {n}
  — '{theme}'" + a one-line blurb + the locked URL. This is for the operator
  to drop in the league chat so members know a new digest landed.
- **Actions** — `↗ Send to WhatsApp` (uses the existing WhatsApp bridge),
  `⧉ Copy share card`, `⧉ Copy link only`. Honors the Announce config: `link
  only` skips the card, `silent` skips the reshare entirely (still
  publishes).

---

## 8. Data model

`ml-content-data.jsx` is the canonical shape. Operator-side, you need:

```sql
-- Per-league b-side site (mirrors the b-side package's dashboard_sites).
-- Operator writes here; the public route reads read_model.
CREATE TABLE dashboard_sites (
  slug            TEXT PRIMARY KEY,          -- unguessable, minted on first publish
  league_id       TEXT NOT NULL UNIQUE,      -- one site per league
  season          INTEGER NOT NULL,
  read_model      TEXT NOT NULL,             -- JSON snapshot the public site serves
  archived_rounds TEXT NOT NULL,             -- JSON array of round ids already in the archive
  published_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  refreshed_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Per-section publish decision, remembered across updates so 'lock' sticks.
CREATE TABLE dashboard_section_state (
  league_id       TEXT NOT NULL,
  section         TEXT NOT NULL,             -- 'superlatives'|'stats'|'fingerprints'|'moments'|'overlap'
  decision        TEXT NOT NULL DEFAULT 'refresh', -- 'refresh'|'hold'|'lock'
  steer           TEXT,                      -- last steer chips+instructions for this section
  PRIMARY KEY (league_id, section)
);

-- An "update ready" exists when a finalized digest_draft's round_id is not
-- in dashboard_sites.archived_rounds for that league. (digest_drafts comes
-- from the /digest package.)
```

The Archive-tab badge count = number of leagues with at least one finalized
digest whose `round_id` is not yet in `archived_rounds`.

---

## 9. API surface (suggested)

```
GET    /api/content/leagues                        — league rows + b-side state + pending-update flags
POST   /api/content/:leagueId/publish              — first publish: mint slug, build initial read_model
GET    /api/content/:leagueId/update-plan          — the add entry + recompute sections + per-section detail
POST   /api/content/:leagueId/update               — body: {decisions:{section:'refresh'|'hold'|'lock'}, steer:{}, announce} — recompute + rewrite read_model in place
POST   /api/content/:leagueId/reshare              — body: {mode:'card'|'link'|'silent'} — produce the announcement / send via the bridge
```

---

## 10. Things to AVOID

- **Don't ship `design-canvas.jsx`** — review wrapper only.
- **Don't rebuild the Digest tab** — it's the existing pipeline; just wrap
  it in the new tab chrome.
- **Don't mint a new slug on update.** Updates rewrite in place. New slugs
  only on first publish or a deliberate rotation.
- **Don't auto-refresh `lock`ed sections** — that's the whole point of the
  lock. Carry the decision forward in `dashboard_section_state`.
- **Don't regenerate the whole archive every round.** Add the one entry,
  recompute only the sections set to `refresh`.
- **Don't leak operator chrome into the public site.** The 🔒 / ↻ / ✓ glyphs
  and the modal are operator-only (consistent with the existing digest
  screen). The public b-side body never carries them.
- **Don't use stock Tailwind palette colors.** One accent + four states +
  neutral scale. No new hex literals.

---

## 11. Definition of done

- [ ] Sidebar "Digest" → "Content" with a pending-update count badge; `/digest` redirects to `/content`
- [ ] Two tabs (Digest | Archive) in the Mash header-tab idiom; Archive carries the count badge
- [ ] Digest tab renders the existing pipeline unchanged
- [ ] Archive tab lists every league with the correct state: update-ready / up-to-date / not-published
- [ ] "Update archive" opens the modal with the add entry + recompute rows
- [ ] refresh / hold / lock persists per league per section; `lock` survives future updates
- [ ] Steerable sections expose the quick-steer chips + free-text
- [ ] Generate rewrites the read_model **in place on the same slug**; archived_rounds gains the round
- [ ] First publish mints a permanent unguessable slug and builds the initial read_model
- [ ] Published state shows the reshare card; Send to WhatsApp uses the existing bridge; Announce config honored
- [ ] Badge count = leagues with a finalized digest not yet archived
- [ ] No console errors. No hard-coded hex literals. Mash tokens only.

When you're done, open `reference/Music League Bot - Content Screen.html`
side-by-side and compare each of the four artboards to your build, then walk
the happy path: Digest finalize → Archive badge appears → Update modal →
Generate → published + reshare.
