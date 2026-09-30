# Codex brief — add the 3 remaining Boarz S1 recap sections

**From:** Claude (herdr pane pA), 2026-09-24. Handoff of the *additive* digest work.
**Target draft:** `draft-152-bf0a1beb` — round_id **152**, season_id **10** (Boarz II Men), recap.
**DB:** `data/league.db` (already backed up as `data/league.db.bak-boarz-recap-edit-20260924-162909`; make your own backup before writing). All digest work stays in **music-league-bot only** — never `boarz-season-1-cinematic`.

## Already done — DO NOT touch/overwrite these
The top-of-digest sections were just edited on this same draft. Leave them alone; only ADD the three below.
- `podium` → "The Songs at the Top — Season One" (top-8 song list kept as-is, short lead-in body).
- `villain` → "The Season's Least-Loved…" (rewritten rule-correct).
- `flow` → "The Season Arc — A Bit for Everyone" (per-person podium writeup, verbatim locked text, + a positive next-season button).
- `consensus` → **excluded** (cut on purpose).
- `quotes`, `chat` → kept unchanged.

## Add these three (reuse existing machinery — do NOT reinvent)

### 1. Guess-the-Submitter (deterministic, no LLM)
- Season leaderboard across the rounds the game ran (**rounds 5–10**).
- Reuse: `ui/src/lib/digest/guesserSeason.ts` (`buildSeasonPanel`), `guesserSection.ts`, `ui/src/lib/db/guesserInsights.ts`, `GuesserLeaderboard.svelte`. Data lives in the `guess_*` tables.
- Storage: the guesser lives on the **`digest_drafts` row** (`guesser_content_json` / `guesser_state` / `guesser_position`), NOT in `digest_sections`.
- Enable the guesser section for the **boarz-ii-men** league (see `GUESSER_SETTINGS_KEY` in `guesserSection.ts`; memory says it was opted-in 2026-09-05 — verify, don't assume) and set the **guesser player override** correctly: Matt names a submitter on nearly every song; the "chattiest voter" fallback wrongly picks JB (see the note in `guesserSection.ts`).
- Verify it renders deterministically from the DB on the r152 page.

### 2. Regulars — one cast card PER PLAYER (all 10, not the current 5)
- This is the storylines/cast section: `ui/src/lib/digest/storylinesSection.ts`, `StorylinesCast.svelte`, `regularStyles/` (Spotlight, Buzzer, QuoteLed, CallResponse, RosterMap, Refrain, EditHistory, Evidence).
- Players: Matt, JB, Jimmy, Clements, Jensen, Darren, Shane, Steiny, Grant/Koz, Conor.
- `docs/digest-content/r152/digest_v1.md` §3 already has 5 written (Matt=Editor, JB=Mint, Conor=Consul, Jensen=Sleeper Cell, Grant=Flex Auditor). Keep those; author the missing 5 (Jimmy, Clements, Darren, Shane, Steiny) in the same form-over-topic, evidence-required style.
- `storylineEvidence.ts` / `storylineSeeds.ts` are the grounding helpers.

### 3. Coinage — Word(s) of the Year, each WITH a link
- Pick the season's word(s) of the year; each links to its origin (chat message / definition).
- Reuse the coinage/novelty detector: `ui/src/lib/digest/wordCloud.ts`, `chatSuperlatives.ts`, `wordLists.ts`.
- `digest_v1.md` §4 candidates: **lead = "chopped unc"** (Steiny→Jensen, R147; reported spread 7 uses / 4 speakers / 36h, absent from all prior rounds). Runners-up: **"Clam Scam"**, **"Refund/Refundo/Refundora Johnson"**, **"hose drinkers" / "mr butt water"**, **"gaym'n (rhymes with Cayman)"**. RUN the detector against the chat text to confirm spread before locking one as Phrase of the Season.

## Voting rules — must hold in every computed number/claim
- **8 upvotes + 2 downvotes** per player; everyone must spend all 10.
- **Commenting ≠ voting.** A 0-point row in `votes` is a comment, NOT a vote — never count it as a voter or as a "0 vote" (this skews voter counts / variance / turnout).
- **Max 4 points** on any one song; the 2 downvotes may both land on one song or split across two.
- **No-vote penalty:** if a submitter files NO ballot that round, all upvotes on their own song are voided but downvotes still count. USE `ui/src/lib/db/scoring.ts` `SCORED_POINTS_SQL` — do not hand-roll. (Note: a 0-point comment-only row still counts as "filed a ballot" for the penalty, per that file.)
- **No submission → player is simply left out** of that round.

## Guardrails
- `digest_sections.kind` CHECK allows only: podium, villain, flow, consensus, quotes, chat, **storylines**. Guesser/stats/reel are draft-row columns. Don't invent new kinds.
- Back up `data/league.db` before writing; verify each new section actually renders on the r152 recap page (prod-build preview reads the live DB).
- **Do NOT `git push`** (commits are fine per repo policy). Report what you changed + how to view.
- Coordinate: pane pA (Claude) owns the top-3 sections on this draft — only add the three new ones.
