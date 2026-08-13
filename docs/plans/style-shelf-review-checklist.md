# Review — style shelf build (Reviewella)

> **FINDINGS ARE IN [§0](#0-findings--2026-08-13-run) BELOW.** The checklist that produced them follows from §1.
> Review run 2026-08-13, against the full T1–T5 diff. Verified empirically: production
> build (`npm run build`) served from `build/index.js` against a **copy** of `data/league.db`,
> driven with puppeteer-core + Chrome at 800px, 520px `.dg-export--mobile`, in web and
> `?export=1`. Live `data/league.db` was never written to. Nothing committed.

---

## 0b. Re-verification — 2026-08-13, after repairs

Fresh production build, fresh copy of `data/league.db`, same browser harness. **All six findings that
had landed are fixed and browser-confirmed. Zero pageerrors in every scenario.** F7 fixed by
inspection. F8 was my error — retracted below.

**F1 — FIXED, verified in a browser (this was the one that mattered).** The exact repro re-run: R147's
metrics patched to two entries both labelled `speakers`, page loaded and hydrated.

| | before | after |
|---|---|---|
| pageerror | `Svelte error: each_key_duplicate` | **none** |
| `hydrated` | `false` | **`true`** |
| `coinagePresent` | `false` | **`true`** |
| `metricsRendered` | `0` | **`2`** (both `speakers`) |

Confirmed in **both** web and `?export=1` @800px. SSR-only verification genuinely could not have caught
this — the crash is in the client hydration pass — so it was worth re-running.

**F3 — FIXED, fails closed.** Gauntlet, all with the Coinage card still rendering and no errors:

| `source:` | link | href |
|---|---|---|
| `javascript:alert('xss')` | none | — |
| `data:text/html,<script>…` | none | — |
| `//evil.com/x` | none | — |
| `urbandictionary.com/…` (no scheme) | none | — |
| `https://www.urbandictionary.com/…` | rendered | preserved verbatim |
| `HTTPS://WWW.…` (uppercase scheme) | rendered | preserved verbatim |

The no-scheme case fails closed and quietly, as the lead intended — no link, no broken relative href.
(Uppercase schemes pass, which is correct: `new URL` normalises `protocol` to lowercase.)

**F2 — FIXED.** Both pre-redesign paragraphs are back on the live R147 payload: Mashew's *"Types faster
than his own punctuation"* and Conor's *"two hundred words on why the voting is corrupt"*.

**F4 — FIXED.** `DigestInsights.svelte:162/168/205/209/222` are all index-keyed now.

**F5 — FIXED.** The 52-character unbroken alias no longer escapes the frame:
`839/798 → 798/798` at 800px, `829/428 → 428/428` at mobile.

**F6 — FIXED, and better than asked.** `seasonArcCaption()` now branches: over the cap it reads
*"last 10 of 17 rounds · average over all 17"*; at or under it, *"hit-rate over 4 rounds"*. The capped
branch can't be exercised in a browser today (SSSC has 4 rounds) so it was checked as a pure function.

**F7 — FIXED** (`pendingYaml` parks the unparsed text; `toYamlMode` restores it). Not browser-tested —
it needs an authenticated review-screen interaction, and the logic is legible.

**F8 — RETRACTED, I was wrong.** `marks: [23:25, 23:58]` parses as `["23:25","23:58"]`, not a map: in
flow context a `:` is only an indicator when followed by a space. `yamlContent.ts:63` already says so.
No issue here.

**Regression sweep after the shared-path changes** (`resolveStyle` trim, `splitRepairRuns` padding,
`unquote` mismatched pairs): the full 7-style torture cast re-run clean — all six heroes VISIBLE in web
and export, 10 flat cards / 0 triggers in export vs 10 triggers / 10 open panels on web, no script
elements, no dialog, injected markup still printed as text. Tests **113/113** (up from 97).
`svelte-check` **9 errors**, unchanged — no new type errors from the repairs.

---

## 0. Findings — 2026-08-13 run

### Verified clean (not findings — recorded so they aren't re-tested)

- **Zero `{@html}` / `innerHTML`** in any changed or new file. (`TastemakerSection.svelte:226` has one; it is
  pre-existing and out of scope.) A torture payload carrying `<script>alert(3)</script>`,
  `<img src=x onerror=alert(2)>` in `note`, `motif` and `evidence` rendered as **text** — no dialog fired,
  0 `<script>` elements, 0 `img[src=x]`.
- **Zero raw hex, zero `rgba()`** in the new/changed CSS. The Guesser's gradient and average line were
  correctly rebuilt as `color-mix()` over `--moss` / `--mash-pulp` / `--ember`.
- **Hydration under torture: clean.** A cast exercising all 7 styles with duplicate `exchanges[].reply`
  (`Is`/`Is`/`Is`), duplicate `stats[].label`, `occurrences: [aug 5, aug 5, aug 5]`, duplicate
  `buzzer.marks`, duplicate `pairs[].alias`, an unmatched `⟨someoen⟩`, an unclosed `⟨unclosed`, regex
  metacharacters in `highlight` (`(`, `*`, `[`), an unknown `style:`, a declared style with no payload,
  and a fully empty entry → **no pageerror, no console error, in all three modes.**
- **Degradation works.** Missing payload → `quote-led`; typo'd style with a valid taxonomy `type` whose
  style also lacks payload → `quote-led`; empty entry → `quote-led`. Confirmed on the rendered page.
- **Export parity.** `?export=1` produced 10 flat `.stl-card`s and **0** accordion triggers; web produced
  10 triggers with **10 open panels**. All six non-default heroes (`.rs-spot .big`, `.reply`, `.edline`,
  `.rs-map .alias`, `.rs-refrain .big`, `.buz .mk`) measured **VISIBLE in both modes**.
- **Coinage media swap.** Web renders `<video src=…chopped_unc.mp4>`; `?export=1` renders
  `<img src=…chopped_unc.jpg>`. Absolute `/_media/` URLs preserved.
- **R147 Coinage back-compat.** The live payload's `gloss` → definition, `meta` → flag line,
  `quotes[]` → usages (4 rendered), `metrics[]` → metric row all still render; term highlighting
  matched 3 times including the plural "chopped uncs".
- **Scope.** No schema migration, no new `digest_sections.kind` (still the 7-value CHECK at
  `ui/src/lib/db/schema.ts:199`), no detectors, matching logic / core LLM sections / export pipeline /
  `DigestSection` action-bar wiring untouched. One new dep (`yaml ^2.9.0`). `regularStyles.ts`
  signatures unchanged.
- **Types & tests.** 97/97 pass in the three new/changed suites. `svelte-check` error list diffed
  against a HEAD worktree: **10 errors at HEAD → 9 now, no new errors** (the diff fixed the
  `DigestKind` assignability error). The 12 unrelated suite failures are pre-existing, as stated.
- **Responsive.** With realistic content, `.dg-export` scrollWidth == clientWidth at both 800px
  (798/798) and mobile (428/428). Mobile correctly drops to 1 Guesser annotation (2 → 1).

### F1 · BLOCKER · confirmed crash — `DigestInsights.svelte:189`

```svelte
{#each phraseMetrics as m (m.label)}
```

The key is a **hand-authored label**. This is the legacy-payload path, i.e. exactly what the live R147
draft uses. Two metrics sharing a label kills the entire page.

**Reproduced**, not theorised. Patching the R147 `stats_content_json` metrics to
`[{value:"7",label:"speakers"},{value:"4",label:"speakers"}]` and loading `/digest/147`:

```
errors: [ 'PAGEERROR Svelte error: each_key_duplicate' ]
{ metricsRendered: 0, coinagePresent: false, hydrated: false }
```

The whole document fails to hydrate — Coinage gone, storylines accordion gone. In the export path this
is the historical `Waiting for selector .dg-export failed`. Restoring distinct labels restores the page
(`metricsRendered: 2, hydrated: true`), which confirms the key is the sole cause.

**Fix:** `{#each phraseMetrics as m, i (i)}`. Same one-line change the Guesser already took.

### F2 · MAJOR · content regression on the live R147 draft — `regularStyles.ts:188-210`

`normalizeCast()` reads `m.note`; it does not read `m.headline`. Every existing storylines row in the DB
carries `headline` and no `note`. The prose is silently dropped.

**Confirmed on the rendered page:** loading `/digest/147` from a copy of the live DB,
`document.body.innerText` no longer contains `"Types faster than his own punctuation"` — Mashew's and
Conor's headline paragraphs are gone. Both entries resolve to `quote-led` and render evidence quotes only
(`styleCards: ["quote-led","quote-led"]`).

Dropping the paragraph is the intended design (HANDOFF T1), so this is not a bug in the build — but R147
is **awaiting the owner's approval right now** and its payload has not been re-authored into the new
shape. Shipping as-is silently deletes reviewed copy from a digest the owner already signed off on.

**Route to the owner, two options:** (a) re-author R147's storylines YAML into the new per-style shapes —
the intended path, and the reason the YAML editor exists; or (b) add a `note: str(m.note) || str(m.headline)`
fallback in `normalizeCast`. (b) touches the frozen contract, so it is the lead's call, not a repair
anyone should make unilaterally.

### F3 · MINOR · unguarded URL into `href` — `DigestInsights.svelte:203`

```svelte
<a href={phrase.source} …>{phraseSourceLabel}</a>
```

**Confirmed:** setting `source: "javascript:alert('xss')"` renders
`sourceHref: "javascript:alert('xss')"` as a live link. Owner-authored rather than attacker-controlled,
but the digest is published publicly at `digest.mattmariani.com`, so a paste accident ships. Gate on
`/^https?:\/\//i` and fall back to plain text.

### F4 · MINOR · remaining value keys in the same file — `DigestInsights.svelte:146, 152, 206`

`(visual)`, `(item.word)`, `(item.artist + item.priorTitle)`. Pre-existing and unchanged by this diff,
but the same failure class as F1, in the file F1 lives in, over derived/LLM data. Worth clearing while
F1 is open rather than waiting for the next duplicate to find them.

### F5 · MINOR · roster-map can clip out of the export frame — `RosterMap.svelte:35-49`

`.rs-map` is `grid-template-columns: 1fr auto 1fr` with no `min-width: 0` and no `overflow-wrap`, so a
grid item cannot shrink below its longest unbreakable token.

**Reproduced:** a 52-character alias with no spaces pushed `.dg-export` to `scrollWidth 839 / clientWidth 798`
at 800px and `829 / 428` at mobile — ~41px of the card clipped out of the PNG. Realistic multi-word
aliases ("the artist formerly known as Jensen") wrap fine and produce no overflow, so this needs a
pathological hand-authored value. `min-width: 0` + `overflow-wrap: anywhere` on `.real` / `.alias` closes it.

### F6 · MINOR · season-arc label vs. season average — `GuesserLeaderboard.svelte:197` / `guesserInsights.ts:432`

`seasonHitRates` is capped to the last `SEASON_ARC_ROUNDS = 10`; `seasonRate` is deliberately computed
over the **whole** season (correct, and well-commented). But the block label reads
`the season so far · hit-rate over {seasonBars.length} rounds` directly above `season avg {pct}` — once a
league passes 10 rounds the strip says "over 10 rounds" while the number beside it covers more. Latent
today (SSSC renders 4 bars). Against the section's stated "deterministic honesty" principle, so worth a
word change — e.g. "last 10 rounds · season avg over all N".

### F7 · MINOR · invalid YAML is silently discarded on mode toggle — `SectionInlineEditor.svelte:88-96`

`toFieldsMode()` keeps the form unchanged when the YAML doesn't parse (good), but `toYamlMode()`
re-serialises from `fields`, so the owner's half-written text is gone on the way back. Saving is correctly
blocked while invalid (`canSave`), and the parse error is specific and line-numbered — the flow is sound,
this is just the one edge that loses typing. Preserve `yamlText` and re-show it instead of re-serialising.

### F8 · NIT · flow-scalar hazard not covered — `yamlContent.ts:57`

`findFlowCommaHazard` catches the `{at: Jensen, over an Outside Lands gif}` case very nicely. It does not
catch `marks: [23:25, 23:58]`, where a 24-hour time in a flow sequence parses as a map. Only bites the
`buzzer` style with 24h times; `11:25pm` is unaffected. Mentioning it so it's a known limit, not a
surprise later.

---

## Checklist used



Scope of review: T1–T5 output across `regularStyles/*.svelte` (new), `StorylinesCast.svelte`,
`DigestInsights.svelte`, `GuesserLeaderboard.svelte`, `guesserInsights.ts`, `roundInsights.ts`,
`yamlContent.ts`, `SectionInlineEditor.svelte`, and the two new test files.

Authorities: `docs/plans/style-shelf-build.md` (decisions + hard rules), HANDOFF §5/§6/§9/§10,
frozen contract `ui/src/lib/digest/regularStyles.ts`.

Verdict per item: **PASS / FAIL / N/A**. Any FAIL under §1, §2, §6 or §7 is a ship blocker —
R147 is live and awaiting approval.

---

## 1. Hydration safety — `each_key_duplicate` is fatal (BLOCKER)

This repo has already shipped a fatal `each_key_duplicate` crash from keying an `{#each}` on a
value that tied (ranks). The symptom is *not* a visible error: the whole digest page fails to
hydrate and the PNG export dies with the misleading `Waiting for selector .dg-export failed`.
Assume any key derived from user-, owner- or LLM-authored data can collide.

- [ ] **1.1** Every new/changed `{#each}` has an explicit `(key)`. No unkeyed `{#each}` in the
      digest tree at all — an unkeyed block is a silent invitation to key it badly later.
- [ ] **1.2** Keys are index keys `(i)` unless there is a proven-unique DB id. The existing safe
      pattern is `StorylinesCast.svelte:141/151/165` (`as m, i (i)`) and `ChatMoments.svelte:71/82/94`.
      Follow it in every new style component.
- [ ] **1.3** Hunt these specific collision candidates in the current tree and in new code:
      - `GuesserLeaderboard.svelte:188,193` — `{#each seasonBars as b (b.label)}`. Two rounds
        rendering the same short label (e.g. two `R14`-truncations, or a repeated round number
        across seasons) = duplicate key = dead export. **Must be `(i)` or `(b.roundId)`.**
      - `GuesserLeaderboard.svelte:203` — `{#each annotations as a (a.pos)}`. Two landmarks can
        fire at the same play position (a `✓ hit` comment that also matches 💧). **Must be `(i)`.**
      - `GuesserLeaderboard.svelte:237` — `(row.playerId)` is fine **iff** `eludesHim` cannot
        contain a player twice; verify the query groups by player.
      - `DigestInsights.svelte:78` — `(visual)`; `:84` — `(item.word)`; `:118` — `(m.label)`;
        `:126` — `(item.artist + item.priorTitle)`. All are value keys over LLM/derived data.
        Two metrics sharing a label, or the same artist+title callback pair appearing twice,
        crashes the page. Prefer `(i)`.
- [ ] **1.4** New style components: `refrain.occurrences[]` (repeat dates), `buzzer.marks[]`
      (two marks at the same timestamp), `pairs[]` (same alias twice), `stats[]` (same label),
      `exchanges[]` (same one-word reply twice — *`Is` / `Is` is exactly Conor's motif*),
      `markRuns()` / `splitRepairRuns()` output (repeated run text). **All of these tie by
      design.** Every one of them must be index-keyed.
- [ ] **1.5** No `{#key}` block keyed on hand-authored content.
- [ ] **1.6** Verified empirically, not by reading: production build + real `data/league.db`,
      load the digest page, confirm zero `pageerror` / no `each_key_duplicate` in the console.
      `npm run dev` crashes this page on hydration for an unrelated reason (node:crypto via
      `llm.ts`) — a dev-server failure proves nothing and a dev-server success proves less.

## 2. No HTML injection (BLOCKER)

- [ ] **2.1** Zero `{@html ...}` anywhere in the changed files. Grep it; no exceptions,
      including "just for the ⟨⟩ redline" and "just for the term highlight".
- [ ] **2.2** All emphasis goes through `markRuns(text, tokens)` / `splitRepairRuns(text, repairs)`
      run arrays, rendered as `<b>`/`<s>`/`<span>` elements around `run.t`.
- [ ] **2.3** The Coinage's "term highlighted in the usages" uses `markRuns`, not a
      string `.replace()` that builds markup.
- [ ] **2.4** No `innerHTML`, no `DOMParser`, no `new Function`, no `sanitize`-then-inject.
- [ ] **2.5** `media.src` / `media.poster` / `source` URLs are rendered into `src`/`href` only.
      Check a `javascript:` value in `source:` cannot become a live link (relative/absolute-http
      guard, or at minimum it degrades to plain text).

## 3. Tokens — semantic names only, no mock hexes

The mock's hexes **do not match the shipping tokens**. Lifting them silently forks the palette:

| Mock (HANDOFF §9) | Shipping token (`lib/shortlist/colors_and_type.css`) |
|---|---|
| amber `#ffc061` | `--amber` = **`#e8a83a`** |
| moss `#4fb477` | `--moss` = **`#3ec27a`** |
| ember `#e0576e` | `--ember` = **`#e6566c`** |
| bg `#0e1013`, panel `#15181d`, card `#1a1e24`/`#20242b` | `--ink-0`…`--ink-3` |
| line `#282d35`/`#363c45` | `--line` / `--line-strong` |
| fg ramp `#f2efe8`…`#5c626c` | `--fg` / `--fg-2` / `--fg-muted` / `--fg-quiet` |
| pulp `#ff5b2e` | `--mash-pulp` *(only exact match)* |
| quote-bar `#7d86c9` | **no token exists** |

- [ ] **3.1** Grep the changed files for `#[0-9a-fA-F]{3,8}` in CSS. Every hit is a finding
      unless it is an alpha-tint of an existing token that has no `-soft` alias — and even then
      prefer `color-mix()` / the existing `--*-soft`.
- [ ] **3.2** Allowed set only: `--fg`, `--fg-2`, `--fg-muted`, `--fg-quiet`, `--surface`,
      `--surface-2`, `--ink-0`…`--ink-5`, `--line`, `--line-strong`, `--mash-pulp`,
      `--mash-pulp-soft`, `--mash-pulp-edge`, `--amber`, `--amber-soft`, `--moss`, `--moss-soft`,
      `--ember`, `--ember-soft`, `--font-display`, `--font-mono`, `--font-body`.
- [ ] **3.3** `quote-bar #7d86c9` has no token. Either it resolves to an existing token or a new
      one is added at `:root` in `colors_and_type.css` — **not** hard-coded per component.
      (Adding a `:root` token is arguably outside T1–T4's exclusive file lists → flag to lead.)
- [ ] **3.4** `--amber` marks *the tell itself* and nothing else (HANDOFF §6). Amber used as
      generic decoration is a finding.
- [ ] **3.5** Type: display sizes via `--font-display`, eyebrows/numerics via `--font-mono`
      (~10px uppercase, `letter-spacing: .14–.16em`), body via `--font-body`. No `font-family`
      literals.
- [ ] **3.6** Decision 1 of the build plan is settled: **one surface, dark.** No `.paper` var
      block, no light-mode branch, no `prefers-color-scheme` in the Guesser rebuild.

## 4. Dual-mode / export correctness

- [ ] **4.1** Export detection is exactly the shipping idiom:
      `const isExport = $derived(page?.url?.searchParams?.get('export') === '1');`
      (`ChatMoments.svelte:53`, `DigestInsights.svelte:42`). No `window.location`, no
      `browser`-gated check, no prop drilling a second source of truth.
- [ ] **4.2** `?export=1` prints **everything flat**. No `<details>`, no accordion, no
      `max-height` clamp, no "show more" trigger left in the export branch.
- [ ] **4.3** Each style's hero element is visible in **both** modes: spotlight word,
      call-response reply, redlined example, roster map, refrain token, buzzer track,
      quote-led evidence. Only *secondary* evidence may collapse on web.
- [ ] **4.4** Nothing is hover-only or focus-only — no content that exists solely in `:hover`,
      `title=`, or a tooltip. The PNG is the deliverable.
- [ ] **4.5** Coinage gif: `?export=1` renders `media.poster` in the gif slot. Animated frames
      never capture. If `poster` is missing the slot degrades (still frame absent → no broken
      image icon, no layout collapse).
- [ ] **4.6** Media URLs are absolute `/_media/*` (served via `Caddyfile.digest`), never relative
      under `digests/d/<slug>/`.
- [ ] **4.7** No CSS animation/transition on anything the exporter must capture; no
      `content-visibility`, `loading="lazy"`, or IntersectionObserver-gated reveal that could
      leave the export blank.
- [ ] **4.8** The `.dg-export` selector the exporter waits on is still present and reachable —
      the section renders *something* even in its worst state (see §5).

## 5. Defensive rendering — content is hand-authored YAML

Both new sections are hand-authored until BACKLOG 0. A human typo must degrade, never crash.

- [ ] **5.1** `normalizeCast()` is the **only** entry point into cast data. No component reads
      `content.cast` or `section.content_json` directly, no ad-hoc `?? []`.
- [ ] **5.2** `resolveStyle()` is the **only** style selector. No `{#if entry.style === 'refrain'}`
      chains that bypass the payload-presence degrade in `stylePayloadPresent()`.
- [ ] **5.3** The style registry has an entry for every name in `REGULAR_STYLE_NAMES`, and an
      unknown style resolves to `quote-led` rather than rendering nothing.
- [ ] **5.4** Per-style empty-field behaviour, checked by actually feeding malformed YAML:
      - `spotlight` with empty `caption`; `call-response` with an empty `prompt`
      - `edit-history` with `stats` but no `example`, and with `example.text` containing
        `⟨token⟩` that matches **no** entry in `repairs[]` (`splitRepairRuns` returns
        `repair: null` — the component must handle it)
      - unbalanced `⟨` with no closing `⟩`
      - `roster-map` with 1 pair; `refrain` with `occurrences: []`; `buzzer` with 1 mark
      - `evidence: []` on a `quote-led` entry
      - `highlight` token that appears in no quote, and a `highlight` token containing regex
        metacharacters (`markRuns` escapes them — confirm it isn't re-implemented anywhere)
- [ ] **5.5** n=0 renders the dashed empty card (HANDOFF §5.3.5); n=1 looks intentional, not
      like a broken grid. Both are the *modal* states of this section.
- [ ] **5.6** Long-content safety: a 200-char one-word "reply", a 40-char alias, a name with no
      spaces — `overflow-wrap`/`min-width: 0` present so nothing blows the 800px export width.
- [ ] **5.7** `unquote()` is applied where the component adds its own quote marks, so quotes
      don't double up (already applied inside `normalizeCast`; confirm no second layer).
- [ ] **5.8** YAML editor (T2): malformed YAML surfaces a readable parse error and **does not
      save**; the Fields ⇄ YAML toggle round-trips without dropping unknown keys; switching
      modes never silently discards the owner's hand edits.
- [ ] **5.9** No `throw` reachable from render, no non-null assertions (`!`) on YAML-derived
      values, no `.map()` on a possibly-undefined array.

## 6. Scope discipline — HANDOFF §10 (BLOCKER)

Diff-level check: `git diff --stat` against the pre-build tree; every touched file must appear
in the T1–T5 exclusive-ownership table in `style-shelf-build.md`.

- [ ] **6.1** No changes to the deterministic matching logic (Guesser matcher: despaced word-run
      + edit-distance-1).
- [ ] **6.2** No changes to the core LLM sections or their prompts.
- [ ] **6.3** No changes to the export pipeline / Puppeteer render path / archive build.
- [ ] **6.4** No changes to `DigestSection` action-bar wiring; both sections still sit inside the
      existing shell with header/actions intact.
- [ ] **6.5** No new `digest_sections.kind`, no CHECK-constraint edit, no schema migration.
      (A new kind would force a `force:true` full regen that discards hand edits — that is why
      this work rides `storylines` + stats content.)
- [ ] **6.6** No detectors built (no tic miner, no Coinage detector). Both sections stay
      hand-authored YAML. Stand-in numbers (Mashew 12/9, Grant +35, Paletz times) remain **wired
      to the YAML**, not hard-coded in the component.
- [ ] **6.7** `regularStyles.ts` exported signatures unchanged — it is frozen. Any needed field
      should have come back to the lead, not been added unilaterally.
- [ ] **6.8** No `git push`. Verify `git log origin/master..HEAD` is local-only and flag if the
      branch is ≥10 commits ahead.
- [ ] **6.9** No new runtime dependency beyond the YAML parser T2 was authorised to add
      (`ui/package.json`); check the lockfile diff matches and the parser is used in **safe**
      mode (no arbitrary type construction).

## 7. Backwards compatibility — R147 is LIVE (BLOCKER)

`draft-147-6fdeb375` is in `awaiting_approval` and has been reviewed at
`https://digest.mattmariani.com/d/N6XMpNmZQC2N6oTC`. The rebuild must not break it.

- [ ] **7.1** The **existing** `PhraseOfRound` payload shape still renders: `gloss`, `meta`,
      `quotes[]`, `metrics[]`. The new dictionary fields (`term`, `pronunciation`,
      `part_of_speech`, `definition`, `coined`, `usages[]`, `media`, `source`) are additive and
      optional; a row carrying only the old fields must not blank the card or crash it.
- [ ] **7.2** The **existing** storylines rows (R147's shipped cast, plus the 8 SSSC Regulars
      seeds and the KarBen seed) still render — they have no `style:` and no per-style payload,
      so they must land on `quote-led` via `resolveStyle()`. Check one real row end to end.
- [ ] **7.3** Rows with the *old* mandatory 3-line headline (now replaced by optional `note`)
      degrade cleanly — no empty heading, no dangling separator.
- [ ] **7.4** The LLM's generic missing-kind fallback `{ title, body, items }` (not
      `{ title, cast }`) still produces the n=0 state, not a crash.
- [ ] **7.5** Verify against a **copy** of `data/league.db`, not the live file.
- [ ] **7.6** Nothing in this build requires a regen of R147. If it does, that is a finding —
      a `force:true` full regen discards the punch-up hand edits.

## 8. Responsive

- [ ] **8.1** 800px desktop export width — no horizontal scroll, no clipped hero, descent
      annotations keep ~40px vertical clearance.
- [ ] **8.2** 430px `.dg-export--mobile` — season strip and minirow collapse to one column;
      descent drops to ~1 annotation; `roster-map` / `refrain` / `buzzer` already single-column
      and must stay legible (refrain token ~54px will need a clamp).
- [ ] **8.3** Both widths checked in **both** `?export=1` and web.
- [ ] **8.4** Screenshots captured for the lead at all four combinations.

## 9. Tests (T5) and build health

- [ ] **9.1** `regularStyles.test.ts` covers: every `TYPE_TO_STYLE` entry; explicit-style wins
      over type; unknown style → type fallback; declared style with missing payload → `quote-led`;
      `normalizeCast` on `null` / `{}` / `{cast: "nope"}` / entries missing `name`;
      `markRuns` with regex metacharacters, empty tokens, no match, adjacent matches;
      `splitRepairRuns` with unmatched `⟨⟩`, unbalanced brackets, no brackets; `unquote` on
      smart quotes, nested quotes, an unbalanced leading quote.
- [ ] **9.2** `yamlContent.test.ts` covers round-tripping fields ⇄ YAML and malformed input.
- [ ] **9.3** Tests are new files only — no edits to existing suites (T5's ownership).
- [ ] **9.4** `npm run check` (svelte-check/tsc) clean; `npm test` green; real output pasted,
      not asserted.
- [ ] **9.5** Deploy verification if anything ships: the hermetic-build gotcha means a rebuilt
      image can silently serve stale server `.ts`. Confirm the deploy actually landed
      (`--no-cache` where required) before trusting a live check.

---

### Review output format

For each finding: `file:line` · severity (**blocker** / major / minor) · what breaks · the
concrete failing input. No style-preference notes. Report to lead via `SendMessage to: main`.
No commits, no push.
