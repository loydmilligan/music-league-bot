# Build plan — Guesser / Coinage / Regulars redesign (CD handoff)

**Source of truth:** `docs/Guesser-and-Storylines-redesign.zip` → `HANDOFF.md` (§5 per-section spec,
§6 style shelf, §7 YAML schemas, §9 tokens, §10 flags). Mocks in the zip are the visual truth.
Extracted for this build at `/tmp/claude-1000/-home-loydmilligan-Projects-music-league-bot/fd223f87-32b3-4f24-bdaa-4775e1b4165c/scratchpad/gsr/`.

## Decisions already made (do not relitigate)

1. **One surface — dark.** CD's §2 theme flag is resolved: the whole digest is the dark
   deterministic surface. All sections already use the same shipping semantic tokens
   (`--fg`, `--fg-2`, `--fg-muted`, `--fg-quiet`, `--surface`, `--surface-2`, `--ink-0`,
   `--line`, `--line-strong`, `--mash-pulp`, `--mash-pulp-soft`, `--amber`, `--amber-soft`,
   `--moss`, `--ember`, `--font-display`, `--font-mono`, `--font-body`).
   **Use token names, never raw hexes from the mock.** The mock's `.paper` block is discarded.
2. **The Coinage gets no style registry.** It has exactly one style (`dictionary`) — one adapter
   is a hypothetical seam. Extend the existing phrase card in place; keep `style:` as a
   forward-compatible YAML field that today only accepts `dictionary`.
3. **The Regulars gets a real registry** — seven adapters. Seam is `regularStyles.ts` (done, frozen).
4. **YAML is an editing mode, not a storage format.** DB stays `content_json`. The review
   screen's inline editor gains a Fields ⇄ YAML toggle. No schema migration, no new
   `digest_sections.kind`.

## Frozen contract — `ui/src/lib/digest/regularStyles.ts`

Already written, typechecks clean. **Do not change its exported signatures**; if you need a
field it doesn't have, message the lead. It exports:

- `REGULAR_STYLE_NAMES`, `RegularStyle`, `TYPE_TO_STYLE`
- `RegularEntry` and the per-style payload types (`Spotlight`, `Exchange`, `Stat`, `Repair`,
  `EditExample`, `Pair`, `Refrain`, `Buzzer`)
- `normalizeCast(content) → RegularEntry[]` — defensive coercion, always an array
- `resolveStyle(entry) → RegularStyle` — explicit `style:` → taxonomy `type:` → `quote-led`;
  degrades to `quote-led` when the declared style's payload is missing
- `markRuns(text, tokens)`, `splitRepairRuns(text, repairs)`, `unquote(s)`, `stylePayloadPresent()`

## Work split — no two tasks touch the same file

| # | Owner | Files (exclusive) |
|---|---|---|
| T1 | **Codera 1** | `ui/src/lib/digest/regularStyles/*.svelte` (new), `ui/src/lib/digest/StorylinesCast.svelte` |
| T2 | **Miscellania** | `ui/package.json`, `ui/src/lib/digest/yamlContent.ts` (new), `ui/src/lib/digest/SectionInlineEditor.svelte` |
| T3 | **Repaula** | `ui/src/lib/db/roundInsights.ts`, `ui/src/lib/digest/DigestInsights.svelte` |
| T4 | **Codera 2** | `ui/src/lib/db/guesserInsights.ts`, `ui/src/lib/digest/GuesserLeaderboard.svelte` |
| T5 | **Testerosa** | `ui/src/lib/digest/regularStyles.test.ts`, `yamlContent.test.ts` (new only) |
| T6 | **Reviewella** | review only — no writes until the lead says so |

## Hard rules (from HANDOFF §10 + this repo's history)

- **Never inject HTML.** All emphasis goes through `markRuns` / `splitRepairRuns` run arrays.
- **Every `{#each}` needs a stable unique key.** A duplicate key = `each_key_duplicate` = fatal
  hydration crash = the whole PNG export fails. Prefer index keys `(i)` over value keys.
- **Dual-mode:** `const isExport = page?.url?.searchParams?.get('export') === '1'`.
  Export prints everything flat; web may collapse *secondary* evidence only. Each style's hero
  element is visible in **both**. Animated media never captures → export prints `media.poster`.
- **Verify at 800px and at 430px `.dg-export--mobile`.**
- **Do not touch:** deterministic matching logic, core LLM sections, the export pipeline,
  `DigestSection` action-bar wiring, `digest_sections.kind`.
- **Do not build detectors.** Both new sections are hand-authored YAML until BACKLOG 0.
- Stand-in numbers stay wired to the YAML so the owner can drop real values in.
- `npm run dev` crashes the digest page on hydration (node:crypto via llm.ts) — verify with a
  production build, not dev.
- **Never `git push`.** Commit locally only.
