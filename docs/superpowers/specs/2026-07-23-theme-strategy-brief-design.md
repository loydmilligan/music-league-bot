# Theme Strategy Brief — Design Spec

**Date:** 2026-07-23
**Status:** Approved design → ready for implementation plan
**Feature:** A pre-round, forward-looking strategy brief that, given an upcoming
round's theme, finds prior runs of the same/similar theme across all leagues,
shows how songs performed, and synthesizes what wins, what loses, and what
*you* should submit.

---

## 1. Purpose & primary use

**Job:** Given an upcoming theme (e.g. Boarz II Men R145 *¡No Entiendo, Cabron!*),
let the owner walk away knowing **what to submit** — grounded in how the same
theme played out before.

**User:** The single bot owner ("Mashew" = competitor id 3 → player_id 1, Matt
Mariani). The brief is personalized to the owner; the audience-aware layer
(§7.6) is meaningful only because it compares *the owner's* history against the
target league's roster.

**Forward-looking, decision-support** — not a retrospective browser (that's the
existing Theme Research tab) and not a commissioner recap.

---

## 2. Scope

**In scope (this spec — "Feature A"):**
- Hybrid theme matching (tags shortlist + LLM confirm/rank).
- Podium/cellar per prior run.
- Winner DNA + Cellar Traps analysis (deterministic stats + LLM narrative).
- Familiarity (popularity→points) chart.
- Audience-aware already-played list.
- "What to submit" taste guidance — **lean taste layer**: LLM over the *matched
  runs' vote comments only** (bounded, cheap).
- Web UI view + **MCP tool** surface, both consuming one endpoint.

**Out of scope (deferred to "Feature B", a later spec):**
- General player taste enrichment by scraping *all* WhatsApp chat + comments
  into `player_profiles.taste_fingerprint`. Feature B will share the
  taste-signal-extraction idea and, once built, can upgrade the "what to submit"
  layer here. Do **not** build the full chat scrape now.

**YAGNI notes:** no manual theme-family curation UI; no cross-theme trend
dashboards; no per-player brief (owner-only).

---

## 3. Key decisions (from brainstorm)

| Decision | Choice | Why |
|---|---|---|
| Primary purpose | Pre-round strategy brief | User-selected |
| Comparison scope | All leagues pooled | Prior runs span Fam-Jam, Hip Jammers, Second Best |
| Matching engine | Hybrid: `theme_tags` shortlist → LLM confirm/rank + reason | Best quality; LLM is the arbiter so sparse tags don't break it |
| Taste layer | Lean — matched runs' vote comments only | Bounded cost; Feature B upgrades later |
| Placement | New "Theme Brief" view, on-demand + cached | Costs LLM calls; forward-looking per round |
| Extra surface | MCP tool wrapping the same endpoint | Agents/digest can consume the brief |

---

## 4. Architecture — isolated units

All backend logic lives in bot-ui (`ui/src/lib/theme-brief/`). The `/api`
endpoint and the MCP tool are **two thin consumers** of the same assembly
function; no logic is duplicated in the MCP server.

```
target round
   │
   ▼
themeMatch.ts ──────────► matched prior rounds [{roundId, score, reason, exactness}]
   │  (tag overlap shortlist → 1 LLM call to confirm/rank/explain)
   ▼
themeBriefData.ts ──────► deterministic aggregation
   │   • podium/cellar (SUM points per submission)
   │   • popularity buckets (familiarity stat)
   │   • already-played raw list (owner's subs in matched rounds)
   │
audienceOverlap.ts ─────► per owner-submission: which target-league players saw it
   │   (competitors.player_id → season_players ∩ target roster)
   ▼
themeBriefLlm.ts ───────► synthesis (1 LLM call)
   │   • Winner DNA narrative   • Cellar Traps narrative
   │   • language inference per song (not stored)
   │   • "what to submit" from matched-run vote comments
   ▼
assembleBrief() ────────► ThemeBrief object → cache in theme_briefs → render / return
```

**Unit responsibilities & interfaces:**

- **`themeMatch.ts`**
  - `matchThemes(db, targetRoundId, llm): Promise<ThemeMatch[]>`
  - `ThemeMatch = { roundId, leagueId, seasonLabel, matchScore, exactness: 'exact'|'related', reason }`
  - Tag overlap (`round_theme_tags`) produces a candidate shortlist; one LLM call
    receives the target theme text + candidates' theme text and returns ranked
    matches with a one-line reason. Related-but-distinct themes (e.g. *The Import
    Market* = non-American artists) are returned as `exactness:'related'`.

- **`audienceOverlap.ts`** (pure, no LLM)
  - `ownerExposure(db, ownerPlayerId, matchedRoundIds, targetLeagueId): Exposure[]`
  - `Exposure = { submissionId, roundId, title, artist, seenBy: Player[], recognizable: boolean }`
  - `seenBy` = players in the matched round's season who are ALSO in the target
    league's roster. `recognizable = seenBy.length > 0`.

- **`themeBriefData.ts`** (pure, no LLM)
  - `standings(db, roundId): SongStanding[]` — `{rank, points, title, artist, spotifyUri, submitterIsOwner, popularity, listeners}`.
  - `familiarityBuckets(standings[]): Bucket[]` — the mainstream/mid/obscure→avg-points stat.
  - `podiumCellar(standings): {podium: SongStanding[], cellar: SongStanding[]}`.

- **`themeBriefLlm.ts`**
  - `synthesize(input): Promise<Synthesis>` where input = matched standings +
    vote comments + popularity. Returns `{ winnerDna, cellarTraps, whatToSubmit,
    songLanguages: Record<spotifyUri,string> }`. One call, cheap model
    (`OPENROUTER_DIGEST_MODEL` tier). Prompt is grounded strictly in the supplied
    data (no free invention).

- **`assemble.ts`** — `buildThemeBrief(db, roundId, llm): Promise<ThemeBrief>` —
  orchestrates the above, caches, returns.

---

## 5. Data model

Reuses existing tables: `rounds`, `seasons`, `leagues`, `ml_submissions`,
`votes`, `song_popularity`, `theme_tags`, `round_theme_tags`, `competitors`,
`players`, `season_players`.

**New table `theme_briefs`** (cache, one row per target round):
```sql
CREATE TABLE theme_briefs (
  round_id     INTEGER PRIMARY KEY,
  brief_json   TEXT NOT NULL,      -- serialized ThemeBrief
  model        TEXT,
  cost_usd     REAL,
  generated_at TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
```
Regeneration overwrites the row. No migration risk — additive.

---

## 6. API + MCP surface

- **`GET /api/theme-brief/[roundId]`** → cached `ThemeBrief` (404-safe: if none,
  returns `{ generated:false }`).
- **`POST /api/theme-brief/[roundId]`** → generate (or regenerate with
  `{force:true}`), cache, return. This is the only place the LLM runs.
- **MCP tool `get_theme_brief`** (music-league server, `mcp-server/`) — thin
  wrapper: calls the bot-ui endpoint (bearer as existing digest tools do),
  returns the structured brief so an agent/the digest generator can reason over
  it. Mirrors the existing `generate_digest` / `check_digest_readiness` pattern.
  Input: `{ roundId, force? }`.

---

## 7. The brief's sections (content + computation)

1. **Header** — "¡No Entiendo, Cabron! — the 4th run of this theme." Lists matched
   runs: league/season, sub count, **scoring type** (downvotes on/off — derived
   from whether the league has ever recorded negative points), and match reason.
   Source: `themeMatch` + a per-league scoring lookup.
2. **Podium & Cellar** per run — 🥇🥈🥉 / 🔻 with points. Source: `podiumCellar`.
3. **Winner DNA** — deterministic stats (familiarity buckets, language tally from
   `songLanguages`) + LLM narrative. Grounded example: mainstream (pop 65+) avg
   14.4 pts vs obscure (<45) avg 8.4.
4. **Cellar Traps** — LLM over losing songs + their downvote/critical comments
   (e.g. instrumentals flagged off-theme, abrasive metal as the forced-downvote
   sink).
5. **Familiarity chart** — popularity→points scatter/bar so the pattern is shown,
   not just stated. Source: `standings` popularity + points.
6. **Already-played (audience-aware)** — owner's prior submissions in the matched
   rounds. **Highlighted** when `recognizable` (a current target-league player
   saw it), muted otherwise. Golden example: *Abissama (Incredible Polo)* —
   submitted by the owner in Hip Jammers R69 **and** Second Best R109; Jon Black
   (in Boarz) saw the Second Best one → highlighted "Jon Black would recognize
   this"; the Hip Jammers exposure is muted (no Boarz player saw it).
7. **What to submit** — taste-driven guidance (types of songs this audience
   rewards) synthesized from matched-run vote comments — **not** a single song
   pick. Source: `themeBriefLlm.whatToSubmit`.

---

## 8. Cost, caching, error handling

- **Cost:** ~2 LLM calls per brief (match + synthesis), a few cents, on cheap
  tier. Cached in `theme_briefs`; viewing is free. Regeneration is explicit.
- **No prior runs:** show "first time for this theme" gracefully; skip
  analysis sections; audience/already-played empty.
- **Missing enrichment:** a song lacking `song_popularity` or comments degrades
  (omit from that stat) rather than failing the brief.
- **Sparse `theme_tags`:** tolerated — the LLM confirm step is the arbiter; an
  empty shortlist still lets the LLM scan recent themes.
- **LLM failure:** deterministic sections (podium/cellar, familiarity, audience
  overlap) still render; narrative sections show a "synthesis unavailable" state
  and the brief is not cached as complete.

---

## 9. Testing strategy

- **`audienceOverlap`** — golden test on the Abissama/Jon-Black case (real
  fixture): owner submitted Abissama in R69 (Hip Jammers) + R109 (Second Best);
  target = Boarz (league 5); expect the R109 exposure `recognizable` naming Jon
  Black, the R69 exposure not.
- **`themeBriefData`** — podium/cellar math and popularity-bucket averages
  against the three known rounds (39/69/109) as fixtures.
- **`themeMatch`** — tag-overlap shortlist with a **mocked** LLM; assert exact
  vs related classification (Import Market → related).
- **`themeBriefLlm`** — stubbed model asserts output shape and that it only
  references supplied songs/comments (no invention).
- **Endpoint + MCP tool** — contract tests (GET empty → `generated:false`; POST
  caches; MCP wrapper returns the same structure).
- **Live smoke** — generate the brief for R145 once wired, eyeball against the
  hand analysis in the appendix.

---

## Appendix — grounding data (from live DB, 2026-07-23)

**Prior runs of the exact theme** ("vocals in a language other than English"):

| Round | League · Season | Title | Subs | Scoring |
|---|---|---|---|---|
| 39 | Fam-Jam S2 | Nada de Ingles | 10 | upvote-only (0–10) |
| 69 | Hip Jammers S1 | Nada de ingles | 9 | upvote-only (0–8) |
| 109 | Second Best S1 | ¡No Entiendo, Cabrón! | 10 | downvotes on (−1 to 6) |
| 145 | Boarz II Men S1 | ¡No Entiendo, Cabron! | — | *upcoming (target)* |

Related-but-distinct: R56 Fam-Jam *The Import Market* (non-American artists,
language irrelevant) → should classify as `related`.

**Podiums / cellars:**
- R39: 🥇 CAROLINA – Karol G (23) · 🥈 רוקדים צמודים – Jane Bordeaux / Christine – Christine & the Queens (19) · 🔻 Feliz Navidad (10)
- R69: 🥇 99 Luftballons – Nena (29) · 🥈 Dos Oruguitas – Sebastián Yatra (28) · 🥉 Ven Conmigo – Christina Aguilera (16) · 🔻 Faufile – Charlotte Cardin (4)
- R109: 🥇 Hit Sale – Therapie TAXI (11) · 🥈 Gitana / El Matador – Los Fabulosos Cadillacs (9) · 🔻 Du hast – Rammstein & Malagueña (−1)

**Familiarity → points (pooled 39/69/109):** mainstream (pop 65+) avg **14.4**
(n=11) · mid (45–64) avg **12.7** (n=9) · obscure (<45) avg **8.4** (n=9).

**Winner DNA:** familiarity/crossover fame (Encanto, iconic 80s, chart
reggaeton), upbeat/melodic/danceable, Romance-language (Spanish/French)
over-index.

**Cellar traps:** theme violations (instrumental / too much English → punished),
abrasive/polarizing genres (industrial metal as forced-downvote sink), genuine
obscurity with no hook, novelty read as "too easy."

**Owner (Mashew/Matt) submissions in the theme family:** R39 *Chaiyya Chaiyya*
(Sukhwinder Singh) · R69 *Abissama* (Incredible Polo) · R109 *Abissama*
(Incredible Polo). Boarz players also in prior-run leagues: **Jon Black**
(Second Best), **Matt** (all three).
