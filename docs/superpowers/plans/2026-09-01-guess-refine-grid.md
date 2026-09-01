# C3 — The Refine Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the reasoning board where Matt works out which player submitted which anonymous song — candidate rows per song, a three-state control, and cross-song elimination that visibly propagates.

**Architecture:** Data first, then UI, so nothing is built against a payload that doesn't exist. Tasks 1–3 extend `WorkspaceData` with candidates and availability, add a thin candidate API route, and put the board's derived logic (row ordering, conflicts, the roll-up line) in a **tested `.ts` module** — because there is no component test harness, and logic hidden inside `.svelte` is logic nobody can test. Tasks 4–8 build the surface in layers that each render something real.

**Tech Stack:** Svelte 5 runes, Tailwind v4 against `ui/src/app.css` `@theme` tokens, TypeScript, better-sqlite3, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-31-submitter-guessing-design.md` — **§7.4 and especially §7.4a** (the settled design and five corrections to the handoff packet), plus §5 (anonymity), §6 (assignment rules), §7.1 (gut lock).
**Design handoff (the build target):** `docs/design_handoff_refine_grid/` — read `README.md`, then `DECISIONS.md` and `TOKEN-MAP.md`. `Refine Grid — Full Design.dc.html` is the visual reference to recreate; it is **not** code to copy.

## Global Constraints

- **The handoff packet has five known errors. §7.4a lists them. Trust §7.4a over the packet where they conflict.** The two that matter: `Candidate` has **no `songId`** (it is `{ playerId, status, certainty, factors, notes }`, keyed `(round_id, spotify_uri, player_id)` — songs are identified by **Spotify URI** throughout); and `--dur-fast` / `--dur-base` / `--font-body` **do not exist** in `app.css` (the fonts token is `--font-sans`).
- **The refine layer is gated on `data.gutLockedAt !== null || data.phase === 'refine'`** — never on `phase` alone. Nothing in this repo writes `phase = 'refine'`; `lockGut` sets `'fetch'`. A phase-only gate ships dead code. (§7.4a correction 1.)
- **Data contracts in `ui/src/lib/guessing/candidates.ts` are shipped, tested, and fixed.** `setCandidate`, `removeCandidate`, `candidatesForSong`, `playerAvailability`. Design *to* them. If you believe you need a different shape, **stop and report** rather than changing them.
- **Availability is server-derived and re-read after every status write.** The sudoku propagation is a re-render of `playerAvailability`'s answer, never client-side math. Getting this wrong makes the board lie about how settled a decision is.
- **Persistence:** optimistic local edit + per-item **400ms** debounced PATCH, with `flushPendingSaves()` before any read-after-write and on unmount / round change — exactly the pattern in `ui/src/lib/components/VotingLab.svelte:75-113`. **The state cycle is the exception: it fires immediately**, because it has grid-wide consequences that must not lag.
- **Design the rejected-write state.** A Svelte 5 controlled input goes stale when a write path doesn't end in a changed value; this cost two commits on this exact component (`13f99a6`, `12680fb`) — read the comment at `GuessWorkspace.svelte:31-39` before writing any handler.
- Styling: Tailwind utilities against `ui/src/app.css` tokens. **Never** the `--fg-quiet` / `.mash-*` / `.ml-*` vocabulary from `ui/src/lib/shortlist/colors_and_type.css`.
- **No new dependencies** — no icon, animation, toast, or state library. None exist. Iconography is unicode glyphs (`· — ○ ◐ ● ⚠`) and CSS shapes. **No shadows.** Dark-only. `rounded-sm` buttons, `rounded-lg` inputs.
- **No Svelte component or route test harness exists and you must not invent one.** Logic goes in `.ts` (Vitest); `.svelte` stays thin, verified with `npm run check` plus a real-browser pass.
- `npm run dev` is unusable here (digest hydration crashes via `node:crypto` in `llm.ts`). Browser checks use `npm run build` then `DATA_DIR=<scratch> PORT=5199 node build` against a **copy** of `data/league.db`. Stop the server with **`TaskStop`, never `pkill`**.
- Run from `ui/`. **Watch for cwd drift — it has bitten this project repeatedly.**
- `npm run check` baseline: **13 errors / 96 warnings / 37 files.** Capture before and after; report your delta.
- 12 UI + 1 root test are already red (BACKLOG 6b). Do not attribute them to yourself, do not fix them.
- Empty `IN ()` is NOT a SQLite error in better-sqlite3.
- **Never `git add -A` or `git add .`** — another session has unrelated uncommitted work here. Stage explicit paths only.
- Do not touch: the tab strip, the round page, the other five tabs, the gut-phase UI, the rehearsal controls, or the data contracts.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `ui/src/lib/guessing/workspaceData.ts` (+ test) | + `candidates` per song, + `availability` map | 1 |
| `ui/src/routes/api/guess/[roundId]/candidate/+server.ts` | Thin `PATCH` (upsert) / `DELETE` (remove) | 2 |
| `ui/src/lib/guessing/board.ts` (+ test) | Row ordering, conflicts, the roll-up line — all derived logic | 3 |
| `ui/src/lib/components/RefineBoard.svelte` | The board: song blocks + resting candidate rows | 4 |
| `ui/src/lib/components/CandidateRow.svelte` | Resting row + expand-in-place editor + persistence | 5 |
| `ui/src/lib/components/RosterStrip.svelte` | Click-to-add pills doubling as availability display | 6 |
| `ui/src/lib/components/AvailabilityLedger.svelte` | Sticky 244px side rail | 7 |
| `ui/src/lib/components/GuessWorkspace.svelte` | Mount the refine layer; propagation flash | 4, 8 |

---

### Task 1: Extend the workspace payload with candidates and availability

**Why:** the board cannot be built against a payload that doesn't carry its data. `candidatesForSong` and `playerAvailability` are shipped and tested, but `buildWorkspaceData` exposes neither (§7.4a correction 3).

**Files:**
- Modify: `ui/src/lib/guessing/workspaceData.ts`
- Test: `ui/src/lib/guessing/workspaceData.test.ts`

**Interfaces:**
- Consumes: `candidatesForSong(db, roundId, spotifyUri)`, `playerAvailability(db, roundId, mePlayerId)`, both from `./candidates.js`.
- Produces, on `WorkspaceData`:
  - `WorkspaceSong.candidates: Candidate[]` — that song's candidates, **unordered** (Task 3 owns display order).
  - `availability: Record<number, Availability>` — playerId → `'free' | 'dimmed' | 'taken'`, a plain object because `Map` does not survive JSON.

- [ ] **Step 1: Write the failing tests**

Append to `ui/src/lib/guessing/workspaceData.test.ts`:

```ts
describe('WorkspaceData candidates + availability', () => {
  it('attaches each song its own candidates and no others', () => {
    const { db, songs, players } = seedRound({ songCount: 3, playerCount: 4, mineIndex: null });
    setMeCompetitorId(db, 'boarz-ii-men', players[0]);
    setCandidate(db, 1, songs[1], players[1], { status: 'prime', certainty: 70 });
    setCandidate(db, 1, songs[2], players[2], { status: 'possible' });

    const data = buildWorkspaceData(db, 1)!;
    const bySong = new Map(data.songs.map((s) => [s.spotifyUri, s.candidates]));
    expect(bySong.get(songs[0])).toEqual([]);
    expect(bySong.get(songs[1])!.map((c) => c.playerId)).toEqual([players[1]]);
    expect(bySong.get(songs[2])!.map((c) => c.playerId)).toEqual([players[2]]);
    expect(bySong.get(songs[1])![0]).toMatchObject({ status: 'prime', certainty: 70 });
  });

  // DISCRIMINATING: locked outranks prime. An implementation that returns raw
  // per-song status instead of playerAvailability's grid-wide answer would
  // report this player as 'dimmed' (their status on song 1) and fail.
  it('exposes grid-wide availability, where locked outranks prime', () => {
    const { db, songs, players } = seedRound({ songCount: 3, playerCount: 4, mineIndex: null });
    setMeCompetitorId(db, 'boarz-ii-men', players[0]);
    setCandidate(db, 1, songs[1], players[1], { status: 'prime' });
    setCandidate(db, 1, songs[2], players[1], { status: 'locked' });

    const data = buildWorkspaceData(db, 1)!;
    expect(data.availability[players[1]]).toBe('taken');
    expect(data.availability[players[2]]).toBe('free');
  });

  it('serialises availability as a plain object, not a Map', () => {
    const { db, players } = seedRound({ songCount: 2, playerCount: 3, mineIndex: null });
    setMeCompetitorId(db, 'boarz-ii-men', players[0]);
    const data = buildWorkspaceData(db, 1)!;
    expect(data.availability).not.toBeInstanceOf(Map);
    expect(JSON.parse(JSON.stringify(data.availability))).toEqual(data.availability);
  });
});
```

Add whatever imports the file lacks (`setCandidate` from `./candidates.js`).

- [ ] **Step 2: Run to verify it fails**

Run: `cd ui && npx vitest run src/lib/guessing/workspaceData.test.ts`
Expected: FAIL — `candidates` / `availability` undefined.

- [ ] **Step 3: Implement**

In `workspaceData.ts`, import `candidatesForSong`, `playerAvailability` and the `Candidate` / `Availability` types. Add `candidates: Candidate[]` to `WorkspaceSong` and `availability: Record<number, Availability>` to `WorkspaceData`.

In the songs `.map`, attach each song's candidates:

```ts
  const songs: WorkspaceSong[] = visibleSubmissions(db, roundId)
    .filter((s) => uris.has(s.spotifyUri))
    .map((s) => ({
      ...s,
      gutPickPlayerId: picks.get(s.spotifyUri) ?? null,
      candidates: candidatesForSong(db, roundId, s.spotifyUri),
    }));
```

And before the return:

```ts
  // A plain object, not the Map playerAvailability returns — this payload is
  // serialised to JSON for the client, and a Map becomes {}.
  const availability: Record<number, Availability> =
    Object.fromEntries(playerAvailability(db, roundId, me));
```

Add `availability,` to the returned object.

- [ ] **Step 4: Run to verify it passes, then the suite**

Run: `cd ui && npx vitest run src/lib/guessing/`
Expected: PASS, no regressions against a baseline you capture first.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/guessing/workspaceData.ts ui/src/lib/guessing/workspaceData.test.ts
git commit -m "feat(guessing): expose candidates and grid-wide availability on the workspace payload"
```

---

### Task 2: The candidate API route

**Files:**
- Create: `ui/src/routes/api/guess/[roundId]/candidate/+server.ts`

**Interfaces:**
- Consumes: `setCandidate`, `removeCandidate` from `$lib/guessing/candidates.js`.
- Produces:
  - `PATCH` body `{ spotifyUri: string, playerId: number, patch: { status?, certainty?, factors?, notes? } }` → `{ ok: true }`.
  - `DELETE` body `{ spotifyUri: string, playerId: number }` → `{ ok: true }`.

- [ ] **Step 1: Read the siblings first**

Open `ui/src/routes/api/guess/[roundId]/mine/+server.ts` and `.../gut/+server.ts` and copy their exact conventions: `RequestHandler` typing, `getDb` import path, roundId parsing and validation, the round-exists check, and `error()` usage. **Where this plan and the real siblings differ, the siblings win** — reconcile in their favour and say so in your report.

- [ ] **Step 2: Write the route**

Follow the sibling shape. The specifics this route adds:

- Validate `spotifyUri` is a non-empty string and `playerId` is a positive integer; 400 otherwise.
- Validate `patch.status`, when present, is one of `'possible' | 'prime' | 'locked'`; 400 otherwise. **Do not trust the client for an enum that has a DB CHECK constraint.**
- Validate `patch.certainty`, when present, is `null` or an integer 0–100; 400 otherwise.
- **Guard that `spotifyUri` belongs to this round** — `EXISTS (SELECT 1 FROM ml_submissions WHERE round_id = ? AND spotify_uri = ?)`, 400 otherwise. (The `mine` route has this guard; match it.)
- **No gut-lock gate.** Unlike `mine` and `gut`, refining is *supposed* to happen after the gut slate locks — that is the whole point of the phase. Do not copy that 409.

- [ ] **Step 3: Type-check**

Run: `cd ui && npm run check`
Expected: delta zero against the 13/96/37 baseline.

- [ ] **Step 4: Commit**

```bash
git add ui/src/routes/api/guess/[roundId]/candidate/+server.ts
git commit -m "feat(guessing): candidate upsert/remove route"
```

---

### Task 3: `board.ts` — the derived logic, tested

**Why:** row ordering, conflict detection and the roll-up line are real logic. There is no component test harness, so if this lives in `.svelte` it is untestable. It goes in `.ts`.

**Files:**
- Create: `ui/src/lib/guessing/board.ts`
- Test: `ui/src/lib/guessing/board.test.ts`

**Interfaces:**
- Consumes: `Candidate`, `CandidateStatus` from `./candidates.js`; `WorkspaceData` from `./workspaceData.js`.
- Produces:
  - `sortCandidates(cs: Candidate[]): Candidate[]` — status (locked → prime → possible), then certainty **descending**, `null` last. Pure, does not mutate.
  - `findConflicts(data: WorkspaceData): Map<number, string[]>` — playerId → the spotifyUris where they are `locked`, **only** for players locked on 2+ songs.
  - `rollup(data: WorkspaceData): { text: string; tone: 'progress' | 'conflict' | 'settled' }`.

- [ ] **Step 1: Write the failing tests**

Create `ui/src/lib/guessing/board.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sortCandidates, findConflicts, rollup } from './board.js';
import type { Candidate } from './candidates.js';

const c = (playerId: number, status: Candidate['status'], certainty: number | null): Candidate =>
  ({ playerId, status, certainty, factors: '', notes: '' });

describe('sortCandidates', () => {
  // DISCRIMINATING: input order is deliberately the reverse of expected, and
  // certainty deliberately disagrees with status order — a sort on certainty
  // alone, or a stable no-op, both fail.
  it('orders locked, then prime, then possible', () => {
    const out = sortCandidates([c(1, 'possible', 99), c(2, 'prime', 50), c(3, 'locked', 1)]);
    expect(out.map((x) => x.playerId)).toEqual([3, 2, 1]);
  });

  it('breaks ties by certainty descending, nulls last', () => {
    const out = sortCandidates([c(1, 'possible', null), c(2, 'possible', 20), c(3, 'possible', 80)]);
    expect(out.map((x) => x.playerId)).toEqual([3, 2, 1]);
  });

  it('does not mutate its input', () => {
    const input = [c(1, 'possible', 1), c(2, 'locked', 1)];
    const copy = [...input];
    sortCandidates(input);
    expect(input).toEqual(copy);
  });
});

const mk = (songs: { uri: string; cands: Candidate[] }[]) =>
  ({ songs: songs.map((s) => ({ spotifyUri: s.uri, candidates: s.cands })) } as never);

describe('findConflicts', () => {
  // DISCRIMINATING: player 1 is locked twice AND prime elsewhere; player 2 is
  // locked once. An implementation counting any status, or not requiring 2+,
  // reports player 2 as well and fails.
  it('reports only players locked on more than one song', () => {
    const conflicts = findConflicts(mk([
      { uri: 'a', cands: [c(1, 'locked', null), c(2, 'locked', null)] },
      { uri: 'b', cands: [c(1, 'locked', null)] },
      { uri: 'c', cands: [c(1, 'prime', null)] },
    ]));
    expect([...conflicts.keys()]).toEqual([1]);
    expect(conflicts.get(1)).toEqual(['a', 'b']);
  });

  it('is empty when every lock is unique', () => {
    expect(findConflicts(mk([
      { uri: 'a', cands: [c(1, 'locked', null)] },
      { uri: 'b', cands: [c(2, 'locked', null)] },
    ])).size).toBe(0);
  });
});

describe('rollup', () => {
  it('reports progress while unfinished', () => {
    const r = rollup(mk([
      { uri: 'a', cands: [c(1, 'locked', null)] },
      { uri: 'b', cands: [] },
    ]));
    expect(r.tone).toBe('progress');
    expect(r.text).toContain('1 of 2 locked');
  });

  // DISCRIMINATING: this board is fully locked AND conflicted. Conflict must
  // outrank settled — an implementation checking "all locked" first calls it
  // settled and fails.
  it('reports conflict even when every song is locked', () => {
    const r = rollup(mk([
      { uri: 'a', cands: [c(1, 'locked', null)] },
      { uri: 'b', cands: [c(1, 'locked', null)] },
    ]));
    expect(r.tone).toBe('conflict');
  });

  it('reports settled only when fully locked and conflict-free', () => {
    const r = rollup(mk([
      { uri: 'a', cands: [c(1, 'locked', null)] },
      { uri: 'b', cands: [c(2, 'locked', null)] },
    ]));
    expect(r.tone).toBe('settled');
    expect(r.text).toContain('ready to submit');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ui && npx vitest run src/lib/guessing/board.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `ui/src/lib/guessing/board.ts`. Keep it pure — no DB, no fetch. Copy register for `rollup` per the handoff README §1: progress `3 of 9 locked · 1 song no candidate (#9)`, conflict `1 conflict · <Name> locked #3 & #6 — resolve before submit`, settled `9 of 9 locked · no conflicts · ready to submit`.

Note `rollup` is given only `WorkspaceData` and so has song indices and URIs, **not player names** — return the conflicted player *ids* in the text as `#n` song references, and let the component substitute names via its existing `nameFor` helper if it wants names. Keep `board.ts` free of any name lookup so it stays a pure function of the payload.

Conflict must be evaluated **before** settled.

- [ ] **Step 4: Run to verify it passes**

Run: `cd ui && npx vitest run src/lib/guessing/`
Expected: PASS.

- [ ] **Step 5: Mutation-test the conflict-outranks-settled rule**

In a **disposable git worktree** (never the shared checkout): reorder `rollup` so the all-locked check runs first, rerun, and confirm `reports conflict even when every song is locked` **fails**. Remove the worktree and confirm with `git worktree list` / `git status --short`. Report the real failure output.

- [ ] **Step 6: Commit**

```bash
git add ui/src/lib/guessing/board.ts ui/src/lib/guessing/board.test.ts
git commit -m "feat(guessing): board ordering, conflict detection and roll-up line"
```

---

### Task 4: The resting board

**Files:**
- Create: `ui/src/lib/components/RefineBoard.svelte`
- Modify: `ui/src/lib/components/GuessWorkspace.svelte`

**Interfaces:**
- Consumes: `WorkspaceData` (Tasks 1), `sortCandidates` / `findConflicts` / `rollup` (Task 3).
- Produces: `<RefineBoard {data} {roundId} onchanged={() => load()} />` — `onchanged` is the parent's reload hook; Task 5 fires it after writes.

- [ ] **Step 1: Read the design reference**

Open `docs/design_handoff_refine_grid/README.md` (§"The design, in one screen", §2, §3) and view `Refine Grid — Full Design.dc.html` in a browser (serve the folder; it loads `support.js` alongside). **Recreate it — do not port its inline styles.** Map every value through `TOKEN-MAP.md` to a Tailwind utility.

- [ ] **Step 2: Mount the layer in GuessWorkspace**

Add the import, and render it gated per §7.4a correction 1 — **not on phase alone**:

```svelte
  <!-- spec §7.4a: gated on the gut lock as well as the phase, because nothing
       in this repo writes phase='refine' (lockGut sets 'fetch'). A phase-only
       gate would ship dead code, exactly as it did for the vote layer. -->
  {#if data.gutLockedAt !== null || data.phase === 'refine'}
    <RefineBoard {data} {roundId} onchanged={load} />
  {/if}
```

Per §7.4a, refine **replaces** the gut slate — so the existing gut `<ol>` and its lock button must be hidden under the same condition rather than rendering both. Keep the phase eyebrow, the rehearsal banner and the marked-song banner visible.

- [ ] **Step 3: Build the board's structure**

Two columns: board (`1fr`) + ledger slot (`244px`, Task 7 fills it; leave the column present and empty for now). Per song, in playlist order:
- header: `#n` (mono, `text-accent`) · title (`font-bold text-fg`) · artist (`text-fg-muted`) · right-aligned `gut · <Name>` marker (mono, `text-fg-faint`, **non-editable** — it must not look clickable), plus an ember `⚠ <Name> locked twice` marker when `findConflicts` names this song.
- candidate rows via `sortCandidates(song.candidates)` — Task 5 owns the row component; for this task render a **read-only** row with name, state chip, availability tag, factors/notes dots, certainty mini-bar, and the reserved model slot.
- empty state: dashed mono line `no candidates yet — add a suspect below`, `text-fg-faint`, same `border-l-2 border-border-muted` rail.
- the roll-up line above the board, in the tone `rollup()` returns (`text-fg-dim` / `text-ember` / `text-moss`).

**Reserved model slot:** a hairline-separated dashed placeholder + `—`. It is inert and **must not be removed** — it holds the column so Project D drops in without a reflow (§7.4a).

- [ ] **Step 4: Type-check**

Run: `cd ui && npm run check` — report your delta.

- [ ] **Step 5: Browser check**

Production build against a **copy** of `data/league.db`, per the Global Constraints recipe. Boarz R148, Guess tab. Because `phase` will be `'gut'` or `'fetch'`, reaching the board requires a **locked gut slate** — lock it in your copy (mark your own song, assign every song, click Lock). Confirm: the gut slate is replaced by the board; 9 song blocks render; a song with no candidates shows the empty line; the roll-up line reads `0 of 9 locked`. Seed a couple of candidates with `setCandidate` directly in the copy to see rows render. Stop with `TaskStop`.

- [ ] **Step 6: Commit**

```bash
git add ui/src/lib/components/RefineBoard.svelte ui/src/lib/components/GuessWorkspace.svelte
git commit -m "feat(guessing): the refine board — song blocks and resting candidate rows"
```

---

### Task 5: The candidate row — state cycle, editor, persistence

**Files:**
- Create: `ui/src/lib/components/CandidateRow.svelte`
- Modify: `ui/src/lib/components/RefineBoard.svelte` (use it)

**Interfaces:**
- Consumes: `PATCH`/`DELETE /api/guess/{roundId}/candidate` (Task 2).
- Produces: `<CandidateRow {roundId} {spotifyUri} candidate={c} availability={...} onchanged={...} />`. The row is **fully controlled** — it owns no persistent state beyond in-flight UI flags, and every data edit goes up through `onchanged`, exactly like `VotingLabSongRow.svelte:5-18`.

- [ ] **Step 1: The state chip**

Mono uppercase pill showing the **current** state, itself the click target, cycling `possible → prime → locked → possible`. Glyph + label + rail carry state without color: `○ possible` (`border-border`, `text-fg-dim`), `◐ prime` (amber), `● locked` (accent, rail thickens to 3px). **Fires immediately — not debounced** — `disabled` while in flight, and `stopPropagation` so cycling never expands the row.

After the write, **await the parent's reload** so availability is re-read server-side (Task 8 adds the flash).

- [ ] **Step 2: Expand-in-place editor**

Clicking the row (anywhere but the chip) toggles an editor **in place** below it on `bg-bg-elevated`, same rail. No modal, no navigation, scroll preserved. Stacked fields with 58px mono labels: certainty (**native `<input type="range">`, `accent-accent`**, live mono readout — do not build a custom slider), `factors` textarea (`rows=2`, placeholder `why them — the evidence`), `notes` textarea (`rows=2`, placeholder `loose thinking`), the inert reserved model box, and a right-aligned mono `remove` button calling `DELETE`.

- [ ] **Step 3: Persistence**

Certainty / factors / notes: **optimistic local update on every input + per-item 400ms debounced PATCH**, keyed per `(spotifyUri, playerId)` so editing one row never resets another's timer. Implement `flushPendingSaves()` and call it before any reload and on unmount. Copy the shape from `VotingLab.svelte:75-113` — read it first.

- [ ] **Step 4: The rejected-write state — required**

Read `GuessWorkspace.svelte:31-39` before writing this. On a failed write: keep the attempted value visible, turn the row's rail `border-ember`, and show **one** inline mono line near the control — `couldn't save — retrying · retry now` — matching the app's only error idiom (`font-mono text-sm text-red-400`, no toasts). After a successful reload the DOM reconciles to the server's value. **Every** control needs this, including the state chip.

- [ ] **Step 5: Type-check and browser check**

`npm run check` (report delta), then the browser recipe. Verify: the chip cycles and wraps; the row expands and collapses without losing scroll; typing in notes then immediately clicking away persists (debounce flush); the slider updates the readout live; `remove` deletes the row; and — with the server stopped mid-edit — a failed write shows the ember rail and the inline message rather than silently succeeding.

- [ ] **Step 6: Commit**

```bash
git add ui/src/lib/components/CandidateRow.svelte ui/src/lib/components/RefineBoard.svelte
git commit -m "feat(guessing): candidate row — state cycle, in-place editor, debounced persistence"
```

---

### Task 6: The roster strip

**Files:**
- Create: `ui/src/lib/components/RosterStrip.svelte`
- Modify: `ui/src/lib/components/RefineBoard.svelte`

**Interfaces:**
- Consumes: `data.roster`, `data.availability`, the song's existing candidates, the candidate `PATCH`.
- Produces: `<RosterStrip {roundId} {spotifyUri} roster={data.roster} availability={data.availability} existing={song.candidates} onchanged={...} />`.

- [ ] **Step 1: Build it**

Under each song's rows: an `add` mono label then **every** eligible roster name as a click-to-add pill. Adding calls `PATCH` with `{ status: 'possible' }` and then reloads. Per handoff README §5, the strip is **also the availability display**:
- **free** — `border-border`, `text-fg-muted`, clickable.
- **dimmed** (prime elsewhere) — amber border, `#n` tag, ~74% opacity, **still addable**.
- **taken** (locked elsewhere) — `line-through`, faint, `#n` tag, ~50% opacity, **disabled**.
- **already a candidate on this song** — ~28% opacity, disabled.

The `#n` tag names *where* the player is committed. Deriving it needs a lookup from playerId → the song index where they are prime/locked; put that in `board.ts` as a small pure helper **with a test** if it needs more than a trivial expression.

**Do not build a typeahead.** §7.4a overrides §7.4 here deliberately: 9 local names don't warrant it, and it would hide availability at the moment of choosing.

- [ ] **Step 2: Type-check, browser check, commit**

Verify a taken name is genuinely non-interactive (not merely styled as such), and that adding a candidate makes the pill go to the already-added state without a full page reload.

```bash
git add ui/src/lib/components/RosterStrip.svelte ui/src/lib/components/RefineBoard.svelte
git commit -m "feat(guessing): roster strip — click-to-add pills doubling as availability"
```

---

### Task 7: The availability ledger

**Files:**
- Create: `ui/src/lib/components/AvailabilityLedger.svelte`
- Modify: `ui/src/lib/components/RefineBoard.svelte` (fill the reserved column)

- [ ] **Step 1: Build it**

A **sticky 244px** side rail (`sticky top-4`), `bg-bg-elevated` with `border-border-muted` hairlines. Header `availability ledger` plus a live `N free · N dimmed · N taken` summary. One row per eligible player with the same `border-l-2` rail treatment as candidate rows: rail colour and a mono label encode `free` / `prime #n` / `lock #n`; taken names get `line-through` + faint. Footer legend explains the three rails and the reserved `model % · Project D` key.

Per handoff README §6 this also carries the **songs-vs-players supply count**, which is what makes the unsatisfiable end-state legible — show it (e.g. `9 songs · 9 players`).

- [ ] **Step 2: Type-check, browser check, commit**

Verify the rail stays pinned while the board scrolls, and that locking a player updates the ledger in the same reload as the board.

```bash
git add ui/src/lib/components/AvailabilityLedger.svelte ui/src/lib/components/RefineBoard.svelte
git commit -m "feat(guessing): sticky availability ledger"
```

---

### Task 8: The propagation flash — make the consequence felt

**Why:** this is the moment the whole board exists for. The handoff is explicit: *"do not ship it as a silent swap."* Success criterion #2 is that locking a player produces an obvious, immediate, board-wide consequence.

**Files:**
- Modify: `ui/src/lib/components/RefineBoard.svelte`, `ui/src/lib/components/CandidateRow.svelte`, `ui/src/lib/components/AvailabilityLedger.svelte`

- [ ] **Step 1: Diff availability across a reload**

In `RefineBoard`, keep the **previous** `availability` object, and after a reload compute which playerIds changed. Put the diff in `board.ts` as a pure, tested helper:

```ts
export function changedAvailability(
  before: Record<number, Availability>,
  after: Record<number, Availability>,
): number[]
```

with a test asserting it reports only genuinely changed ids (and a discriminating case where one player changes and another doesn't).

- [ ] **Step 2: The flash**

A **one-shot ~700ms accent-tint** `@keyframes` on rows and ledger entries whose availability changed. No animation library — a scoped `<style>` block with a single keyframe. Retrigger reliably on repeated changes (a keyed block or removing/re-adding the class in a microtask; verify it actually re-fires on a second lock, since a CSS animation will not restart on an already-present class).

Respect `prefers-reduced-motion`: under it, skip the animation and apply a brief static tint instead — the consequence must still be visible.

- [ ] **Step 3: Type-check and the definitive browser check**

This is the acceptance test for the whole plan. On R148 with a locked gut slate and candidates seeded across several songs: **cycle one player to `locked` on one song**, and confirm in one motion that (a) they go `line-through` + `● locked · #n` on every *other* song, (b) their roster pill goes disabled everywhere, (c) the ledger row flips to `lock #n`, and (d) the changed rows flash. Then cycle them back to `possible` and confirm everything reverts.

If that doesn't read as a single obvious consequence, the design has failed its main job — report that rather than declaring the task done.

- [ ] **Step 4: Commit**

```bash
git add ui/src/lib/guessing/board.ts ui/src/lib/guessing/board.test.ts ui/src/lib/components/RefineBoard.svelte ui/src/lib/components/CandidateRow.svelte ui/src/lib/components/AvailabilityLedger.svelte
git commit -m "feat(guessing): availability propagation flash — make the lock consequence felt"
```

---

## Self-Review

**Spec coverage:** §7.4a's six decisions map to Tasks 4 (board, roll-up), 5 (state chip, density, rejected write), 6 (roster strip), 7 (ledger), 8 (propagation); D3's three-signal availability appears in 5, 6 and 7 and must stay consistent across all three. The §13 resolutions — gut pick shown non-editable (Task 4), free-text factors (Task 5), no skip state (Task 4's empty line), refine replaces gut (Task 4 Step 2), row ordering (Task 3) — are each owned by a task. §5 anonymity is untouched: nothing here reads `competitor_id`. §6's "duplicates legal until submit" is honoured by Task 3's non-blocking rollup and Task 2's absent gut-lock gate.

**Deliberately out of scope:** §7.5's comment work — Task 5 leaves the locked row visibly settled as the seam, and builds no more. Project D's likelihood — space reserved, inert.

**Placeholder scan:** Tasks 4–8 describe structure and behaviour rather than reproducing several hundred lines of Svelte, because the `.dc.html` reference *is* the pixel specification and duplicating it in prose would be a worse spec, not a better one. Every such task names the reference section to build from, the tokens to use, and a concrete browser check. Tasks 1–3, where the logic lives, carry complete code and complete tests.

**Type consistency:** `Candidate` is used per §7.4a's correction (no `songId`); songs are keyed by `spotifyUri` in Tasks 1, 2, 5, 6. `availability` is `Record<number, Availability>` in Task 1 and consumed as such in 6, 7, 8. `sortCandidates` / `findConflicts` / `rollup` / `changedAvailability` are defined in Task 3 and 8 and used with matching signatures in 4 and 8.

**Risk I want the reviewer watching:** Tasks 4–8 all edit `RefineBoard.svelte`, so they must run in order and each review should check the previous task's work wasn't disturbed.
