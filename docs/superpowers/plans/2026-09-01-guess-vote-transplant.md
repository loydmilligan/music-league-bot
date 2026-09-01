# C2b — Vote Transplant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the round-page Voting Lab into the Guess workspace tab as the vote phase (§7.6), and give `is_mine` its own narrow writer and a mark-first UI inside the tab — so removing the round-page embed cannot strand the guessing workspace.

**Architecture:** Three moves, in dependency order. (1) `is_mine` gets a **narrow, exclusive writer** in `ballotDb.ts` plus its own thin API route and a "mark your song" control in the gut phase — today the *only* writer is `VotingLabSongRow`'s toggle going through a whole-row upsert, which is why the embed can't simply be deleted. (2) `VotingLabSongRow`'s own mine toggle becomes **read-only display**, leaving exactly one writer and no exclusivity drift. (3) The `<VotingLab>` embed moves off the round page into `GuessWorkspace` at `phase === 'vote'`, dropping the whole-ballot copy (superseded by §7.7 Output) and gaining a module-scoped take cache so tab-switching doesn't re-bill the "Get take" LLM call.

**Tech Stack:** SvelteKit 2 / Svelte 5 runes, TypeScript, Tailwind v4 against `ui/src/app.css` `@theme` tokens, `better-sqlite3`, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-31-submitter-guessing-design.md` — §4a (which embeds go), §6 (assignment rules), §7.1 (gut lock), §7.6 (Vote), §7.7 (Output).
**Research (terrain, read it):** `.superpowers/research/c2b-vote-transplant-inventory.md`

## Global Constraints

- **Run everything from `ui/`.** Watch for cwd drift — it has bitten this project repeatedly.
- Tests: `npx vitest run <file>` from `ui/`. Full suite: `npx vitest run`. Type/template check: `npm run check`.
- **There is no Svelte component or route test harness in this repo, and you must not invent one.** Logic goes in `.ts` and is unit-tested; `.svelte` and `+server.ts` stay thin and are verified with `npm run check` plus manual browser checks. This is an established convention, not an oversight.
- **A test that protects an ordering, exclusivity, or side-effect property needs fixture data where the right and wrong answers DIFFER.** Several tests on this project have passed vacuously. Where a step says "mutation-test this", do it in a **disposable git worktree**, never the shared checkout.
- **Empty `IN ()` is not a SQLite error** in better-sqlite3 — it evaluates false. Do not "fix" it.
- Styling: Tailwind utilities against `ui/src/app.css` tokens (`bg-surface`, `text-fg-muted`, `border-border-muted`, `text-accent`, `text-warn`, `font-mono`). **Do not** use the `--fg-quiet`/`.mash-*`/`.ml-*` vocabulary from `ui/src/lib/shortlist/colors_and_type.css` — that is the other styling system in this repo and mixing them looks visibly wrong.
- UI copy register: lowercase, terse, factual, em-dashes. No exclamation marks, no toasts (none exist). Errors are one inline `font-mono text-sm text-red-400` line.
- **`spotifyUri` can repeat within a round** (two competitors may submit the same track) — `voting_lab_ballot` is keyed `(round_id, spotify_uri)`, so a repeat collapses to one ballot row. That is pre-existing behavior; do not attempt to change it here.
- Scope decisions already made by Matt (2026-09-01) — **do not relitigate**:
  - "Get take" **stays** (its trigger/name may change later; not in this plan).
  - "Load playlist" **stays** — playlist import has no other home.
  - "Copy whole ballot" **is dropped** — §7.7's per-song Output drawer replaces it.
  - The vote-comment **lock is deferred to §7.7**. C2b does not build any lock.
  - The **home-page `VotingLab` embeds stay** (spec §4a). Only the round-page embed moves.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `ui/src/lib/voting-lab/ballotDb.ts` | + `setIsMine` — the narrow, exclusive `is_mine` writer | 1 |
| `ui/src/lib/voting-lab/ballotDb.test.ts` | Tests for it | 1 |
| `ui/src/lib/guessing/workspaceData.ts` | + `mine` on `WorkspaceData` so a marked song stays visible after it leaves `songs` | 2 |
| `ui/src/lib/guessing/workspaceData.test.ts` | Tests for it | 2 |
| `ui/src/routes/api/guess/[roundId]/mine/+server.ts` | New thin `PATCH` route | 3 |
| `ui/src/lib/components/GuessWorkspace.svelte` | Mark-first UI; later, hosts `<VotingLab>` at `phase === 'vote'` | 4, 8 |
| `ui/src/lib/components/VotingLabSongRow.svelte` | Mine toggle → read-only display; take cache wiring | 5, 7 |
| `ui/src/lib/components/VotingLab.svelte` | Drop whole-ballot copy | 6 |
| `ui/src/lib/voting-lab/takeCache.ts` (+ `.test.ts`) | Module-scoped take cache surviving remount | 7 |
| `ui/src/routes/league/[league]/season/[n]/round/[roundId]/+page.svelte` | Remove the unconditional embed | 8 |

---

### Task 1: `setIsMine` — a narrow, exclusive `is_mine` writer

**Why this exists:** `saveBallotEntry` is a whole-row upsert of all 7 ballot columns and is reachable only through `VotingLabSongRow`. The guess tab needs to set `is_mine` **without clobbering** points/rating/notes/draftComment, **without requiring a row to already exist** (Boarz R148 has zero `voting_lab_ballot` rows), and **exclusively** — per spec §6 exactly one song is Matt's own, and `assignment.ts:eligibleSongs` excludes every song with `is_mine=1`, so two marked songs silently corrupt the slate.

**Files:**
- Modify: `ui/src/lib/voting-lab/ballotDb.ts`
- Test: `ui/src/lib/voting-lab/ballotDb.test.ts`

**Interfaces:**
- Consumes: `Database.Database` from `better-sqlite3`.
- Produces: `setIsMine(db: Database.Database, roundId: number, spotifyUri: string | null): void` — marks `spotifyUri` as the owner's song for `roundId` and clears the flag from every other song in that round. Passing `null` clears the round entirely (the unmark path).

- [ ] **Step 1: Write the failing tests**

Append to `ui/src/lib/voting-lab/ballotDb.test.ts`. Match the existing file's import style and DB setup — open it first and reuse whatever helper it already uses to build a schema-loaded in-memory DB rather than inventing a second one.

```ts
describe('setIsMine', () => {
  it('creates a ballot row when none exists', () => {
    const db = freshDb(); // reuse this file's existing helper
    setIsMine(db, 1, 'spotify:track:a');
    const rows = getBallot(db, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ spotifyUri: 'spotify:track:a', isMine: true });
  });

  // DISCRIMINATING: the row already has real values. A naive implementation
  // that reuses saveBallotEntry's whole-row upsert would zero these.
  it('does not clobber the other columns of an existing row', () => {
    const db = freshDb();
    saveBallotEntry(db, 1, {
      spotifyUri: 'spotify:track:a',
      upPoints: 3, downPoints: 1, rating: 4,
      notes: 'kept', draftComment: 'also kept', isMine: false,
    });
    setIsMine(db, 1, 'spotify:track:a');
    const row = getBallot(db, 1)[0];
    expect(row).toMatchObject({
      upPoints: 3, downPoints: 1, rating: 4,
      notes: 'kept', draftComment: 'also kept', isMine: true,
    });
  });

  // DISCRIMINATING: 'a' is already mine, so an implementation that only sets
  // the target and never clears leaves TWO marked songs and this fails.
  it('is exclusive — marking a second song unmarks the first', () => {
    const db = freshDb();
    setIsMine(db, 1, 'spotify:track:a');
    setIsMine(db, 1, 'spotify:track:b');
    const byUri = new Map(getBallot(db, 1).map((r) => [r.spotifyUri, r.isMine]));
    expect(byUri.get('spotify:track:a')).toBe(false);
    expect(byUri.get('spotify:track:b')).toBe(true);
  });

  it('clears the round when passed null', () => {
    const db = freshDb();
    setIsMine(db, 1, 'spotify:track:a');
    setIsMine(db, 1, null);
    expect(getBallot(db, 1).every((r) => r.isMine === false)).toBe(true);
  });

  // DISCRIMINATING: round 2 must be untouched by a round-1 write.
  it('does not leak across rounds', () => {
    const db = freshDb();
    setIsMine(db, 2, 'spotify:track:a');
    setIsMine(db, 1, 'spotify:track:b');
    expect(getBallot(db, 2)[0].isMine).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ui && npx vitest run src/lib/voting-lab/ballotDb.test.ts`
Expected: FAIL — `setIsMine is not a function` / not exported.

- [ ] **Step 3: Implement**

Add to `ui/src/lib/voting-lab/ballotDb.ts`:

```ts
/**
 * The narrow, exclusive `is_mine` writer — the guess workspace's mark-first
 * control (spec §6, §4a). Deliberately NOT `saveBallotEntry`: that upserts all
 * seven ballot columns, so using it here would zero any points/notes/comment
 * already on the row.
 *
 * Exclusive by construction: exactly one song per round may be the owner's, and
 * `assignment.ts:eligibleSongs` excludes every `is_mine=1` song — two marked
 * songs would silently shrink the slate. Pass `null` to clear the round.
 *
 * Wrapped in a transaction so a round can never be observed with two marked
 * songs, or with none when one was intended.
 */
export function setIsMine(
  db: Database.Database,
  roundId: number,
  spotifyUri: string | null,
): void {
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(
      `UPDATE voting_lab_ballot SET is_mine = 0, updated_at = ?
        WHERE round_id = ? AND is_mine = 1`,
    ).run(now, roundId);

    if (spotifyUri === null) return;

    db.prepare(
      `INSERT INTO voting_lab_ballot (round_id, spotify_uri, is_mine, updated_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(round_id, spotify_uri) DO UPDATE SET
         is_mine = 1,
         updated_at = excluded.updated_at`,
    ).run(roundId, spotifyUri, now);
  })();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ui && npx vitest run src/lib/voting-lab/ballotDb.test.ts`
Expected: PASS, all of them.

- [ ] **Step 5: Mutation-test the exclusivity guarantee**

In a **disposable git worktree** (not the shared checkout): delete the `UPDATE ... SET is_mine = 0` statement, rerun the file, and confirm the "is exclusive" test **fails**. Then remove the worktree and confirm it's gone (`git worktree list`, `git status --short`). If that test still passes without the clear, the fixture isn't discriminating — fix the test, not the code.

- [ ] **Step 6: Commit**

```bash
git add ui/src/lib/voting-lab/ballotDb.ts ui/src/lib/voting-lab/ballotDb.test.ts
git commit -m "feat(guessing): narrow exclusive setIsMine writer for the guess tab"
```

---

### Task 2: `WorkspaceData.mine` — keep the marked song visible after it leaves the slate

**Why this exists:** `eligibleSongs` excludes `is_mine=1` songs, so the moment Matt marks his own song it **disappears from `data.songs`** — and with it any way to unmark it. The workspace must surface the marked song separately.

**Files:**
- Modify: `ui/src/lib/guessing/workspaceData.ts`
- Test: `ui/src/lib/guessing/workspaceData.test.ts`

**Interfaces:**
- Consumes: `setIsMine` is not called here; this is read-only. Reads `voting_lab_ballot` + `ml_submissions`.
- Produces: `WorkspaceData.mine: WorkspaceMine | null` where
  `export interface WorkspaceMine { spotifyUri: string; title: string; artists: string }`.
  Task 4's UI consumes `data.mine`.

- [ ] **Step 1: Write the failing tests**

Append to `ui/src/lib/guessing/workspaceData.test.ts`:

```ts
describe('WorkspaceData.mine', () => {
  it('is null when no song is marked', () => {
    const { db } = seedRound({ songCount: 4, playerCount: 4, mineIndex: null });
    setMeCompetitorId(db, 'boarz-ii-men', 1);
    expect(buildWorkspaceData(db, 1)!.mine).toBeNull();
  });

  // DISCRIMINATING: asserts BOTH that the marked song is reported in `mine`
  // AND that it is absent from `songs`. An implementation that just appends
  // the marked song back into `songs` would fail the second assertion.
  it('reports the marked song, and that song is not in the slate', () => {
    const { db, songs } = seedRound({ songCount: 4, playerCount: 4, mineIndex: 2 });
    setMeCompetitorId(db, 'boarz-ii-men', 1);
    const data = buildWorkspaceData(db, 1)!;
    expect(data.mine).toEqual({
      spotifyUri: songs[2], title: 'Song 2', artists: 'Artist 2',
    });
    expect(data.songs.map((s) => s.spotifyUri)).not.toContain(songs[2]);
    expect(data.songs).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ui && npx vitest run src/lib/guessing/workspaceData.test.ts`
Expected: FAIL — `data.mine` is `undefined`, not `null`/the object.

- [ ] **Step 3: Implement**

In `ui/src/lib/guessing/workspaceData.ts`, add the interface and the field:

```ts
export interface WorkspaceMine { spotifyUri: string; title: string; artists: string }
```

Add `mine: WorkspaceMine | null;` to the `WorkspaceData` interface, and inside `buildWorkspaceData` — before the `return` — compute it:

```ts
  // The marked song is excluded from `songs` by eligibleSongs, so it must be
  // surfaced separately or there is no way to unmark it (spec §6).
  const mine = (db.prepare(
    `SELECT s.spotify_uri AS spotifyUri, s.title, s.artists
       FROM voting_lab_ballot b
       JOIN ml_submissions s
         ON s.round_id = b.round_id AND s.spotify_uri = b.spotify_uri
      WHERE b.round_id = ? AND b.is_mine = 1
      LIMIT 1`,
  ).get(roundId) ?? null) as WorkspaceMine | null;
```

Then add `mine,` to the returned object.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ui && npx vitest run src/lib/guessing/workspaceData.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full guessing suite for regressions**

Run: `cd ui && npx vitest run src/lib/guessing/`
Expected: PASS (91 tests before this task's additions; the count grows, nothing goes red).

- [ ] **Step 6: Commit**

```bash
git add ui/src/lib/guessing/workspaceData.ts ui/src/lib/guessing/workspaceData.test.ts
git commit -m "feat(guessing): surface the marked own-song on WorkspaceData"
```

---

### Task 3: `PATCH /api/guess/[roundId]/mine`

**Why this exists:** the UI needs a narrow endpoint. It must refuse the write once the gut slate is locked — changing `is_mine` changes `eligibleSongs`, which would silently invalidate an already-locked slate (spec §7.1 makes gut picks immutable).

**Files:**
- Create: `ui/src/routes/api/guess/[roundId]/mine/+server.ts`

**Interfaces:**
- Consumes: `setIsMine` (Task 1); `getRoundState` from `$lib/guessing/state.js`.
- Produces: `PATCH` accepting `{ spotifyUri: string | null }`, returning `{ ok: true }`. `409` if `gutLockedAt !== null`.

- [ ] **Step 1: Read the sibling route first**

Open `ui/src/routes/api/guess/[roundId]/gut/+server.ts` and copy its exact shape — `RequestHandler` typing, `getDb()`, the round-exists check, `error(...)` usage, and how it parses `params.roundId`. **Do not invent a different convention.** The route below is written to match; reconcile any difference in favor of the existing file.

- [ ] **Step 2: Write the route**

```ts
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/db/index.js';
import { getRoundState } from '$lib/guessing/state.js';
import { setIsMine } from '$lib/voting-lab/ballotDb.js';

/**
 * Mark (or clear) the owner's own song for this round — spec §6. Narrow by
 * design: it must not touch points/notes/comment on the ballot row.
 *
 * Gated once the gut slate locks: is_mine feeds eligibleSongs, so changing it
 * after the lock would invalidate an immutable slate (spec §7.1).
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  if (!Number.isInteger(roundId)) throw error(400, 'bad round id');

  const db = getDb();
  const round = db.prepare('SELECT id FROM rounds WHERE id = ?').get(roundId);
  if (!round) throw error(404, 'round not found');

  if (getRoundState(db, roundId).gutLockedAt !== null) {
    throw error(409, 'gut slate is locked — your song cannot be changed now');
  }

  const body = (await request.json()) as { spotifyUri?: unknown };
  const uri = body.spotifyUri;
  if (uri !== null && typeof uri !== 'string') throw error(400, 'spotifyUri must be a string or null');

  setIsMine(db, roundId, uri);
  return json({ ok: true });
};
```

- [ ] **Step 3: Verify it type-checks**

Run: `cd ui && npm run check`
Expected: no new errors introduced by this file. (The repo has pre-existing check output; compare against the state before your change — do not chase unrelated pre-existing warnings.)

- [ ] **Step 4: Commit**

```bash
git add ui/src/routes/api/guess/[roundId]/mine/+server.ts
git commit -m "feat(guessing): PATCH /api/guess/:roundId/mine, gated on the gut lock"
```

---

### Task 4: Mark-first UI in the gut phase — "my song" as an option in the existing select

**Why this exists:** without a reachable `is_mine` writer in the tab, the gut slate is **unsatisfiable** on any round where songs outnumber eligible players — real today on Boarz R148 (10 songs, 9 players). This is the control that unblocks removing the round-page embed in Task 8.

**Design (Matt's call, 2026-09-01 — do not substitute a separate button):** there is **no separate "Mine" button**. You mark your own song by choosing **"— my song —"** in the song's existing submitter `<select>`. `data.roster` comes from `eligiblePlayers(db, roundId, me)`, which deliberately excludes Matt (spec §6), so this option is a **synthetic entry with the sentinel value `"__mine__"`** — it is not a roster member and must never be treated as a guessable player. Selecting it calls the mine endpoint instead of the gut-pick endpoint. Rationale: one control instead of two, and the affordance sits exactly where the unsatisfiable-slate problem is visible.

⚠️ **This adds a third branch to the code path that produced two desync bugs today** (`13f99a6`, `12680fb`). Read the comment at `GuessWorkspace.svelte:31-39` before writing a line: a `<select>` is uncontrolled once the user edits it, so **every** path that does not end in a changed `gutPickPlayerId` must explicitly restore the element from freshly-reloaded data. The `"__mine__"` path is such a path — the song leaves `data.songs` entirely — so it needs the same treatment as the blank and 409 paths, not an assumption that the re-render handles it.

**Files:**
- Modify: `ui/src/lib/components/GuessWorkspace.svelte`

**Interfaces:**
- Consumes: `data.mine` (Task 2), `PATCH /api/guess/:roundId/mine` (Task 3).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the handler**

In the `<script>` block of `GuessWorkspace.svelte`, after `archiveRehearsal`:

```ts
  let mineBusy = $state(false);

  /**
   * Mark or clear the owner's own song. Always reloads afterwards — marking a
   * song removes it from `data.songs` (eligibleSongs excludes it) and changes
   * `data.validation`, so nothing about the rendered slate survives this write.
   */
  async function setMine(spotifyUri: string | null) {
    mineBusy = true;
    try {
      const res = await fetch(`/api/guess/${roundId}/mine`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ spotifyUri }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { message?: string } | null;
        gutError = body?.message ?? `Failed to save your song (${res.status})`;
      }
      await load();
    } finally {
      mineBusy = false;
    }
  }
```

- [ ] **Step 2: Add the marked-song banner**

Insert immediately **above** the `<!-- Validation summary -->` block:

```svelte
  <!-- spec §6: exactly one song is Matt's own; it leaves the slate once marked,
       so it is surfaced here or it becomes unreachable. -->
  <div class="mb-4 flex items-center gap-3 font-mono text-xs">
    {#if data.mine}
      <span class="text-fg-muted">your song: <span class="text-fg">{data.mine.title}</span> — {data.mine.artists}</span>
      <button
        type="button"
        disabled={mineBusy || data.gutLockedAt !== null}
        onclick={() => setMine(null)}
        class="text-fg-faint hover:text-fg disabled:opacity-60 disabled:cursor-not-allowed tracking-widest uppercase transition-colors"
      >Unmark</button>
    {:else}
      <span class="text-warn">mark your own song first — the slate cannot balance until you do</span>
    {/if}
  </div>
```

- [ ] **Step 3: Add "— my song —" to the existing select, and branch the change handler**

**Do not add a button.** Add a synthetic option to each song's existing submitter `<select>`, above the roster options and below the blank placeholder:

```svelte
          <option value="__mine__">— my song —</option>
```

Then branch `onPickChange` on the sentinel. Read the existing comment at the top of that function first (`GuessWorkspace.svelte:31-39`) — it explains why every non-standard path must explicitly restore the DOM. Insert this **immediately after** the existing `if (raw === '')` block and before the `gutError = null;` line that begins the gut-pick PATCH:

```ts
    if (raw === '__mine__') {
      // Marking removes this song from data.songs entirely (eligibleSongs
      // excludes is_mine=1), so this <select> is about to be unmounted on the
      // success path. On any FAILURE path it survives, still showing
      // "__mine__" — a value that is not a real pick. setMine() reloads, and
      // the restore below puts it back to the server's truth either way.
      // Same hazard as the blank and 409 paths; same fix.
      await setMine(song.spotifyUri);
      restoreFromFreshData();
      return;
    }
```

`restoreFromFreshData()` already resolves to `''` when the song is gone from fresh data, which is correct — but note it reads `data?.songs.find(...)`, so confirm by reading it that a missing song yields the blank value rather than throwing.

⚠️ **The sentinel must never reach the roster.** `data.roster` excludes Matt by design (spec §6). `"__mine__"` is a UI-only value: it must not be sent to the gut endpoint, must not be counted as a duplicate by validation, and must not appear in `data.roster`. Verify by reading that the branch above returns before any `/gut` PATCH can fire.

- [ ] **Step 4: Type-check**

Run: `cd ui && npm run check`
Expected: no new errors.

- [ ] **Step 5: Verify in a real browser against real data**

⚠️ **`npm run dev` is unusable here** — digest hydration crashes under dev via `node:crypto` in `llm.ts`. Use a production build against a **copy** of the DB:

```bash
cp data/league.db /tmp/c2b-check/league.db     # a COPY; never the live file
cd ui && npm run build
DATA_DIR=/tmp/c2b-check PORT=5199 node build
```

Open Boarz R148's round page → **Guess** tab. Confirm, in order:
1. The warning line shows and the slate reports "10 songs missing a pick" style validation.
2. Every song's dropdown offers **"— my song —"** above the roster names, and the roster itself does **not** contain Matt.
3. Choosing "— my song —" on one song makes it vanish from the slate and appear in the banner.
4. Choosing "— my song —" on a *different* song moves the banner and returns the first song to the slate — exclusivity, end to end.
5. Choosing it on a song that **already has a guess** works too, and that guess does not linger anywhere visible.
6. **Unmark** returns the song to the slate and restores the warning.
7. With the own-song marked, the slate can be fully assigned and **Lock gut slate** enables — the thing that was impossible before this task.
8. After locking, the selects are disabled and **Unmark** is disabled.
9. **The desync check** (this is the bug class that cost two commits today): with the gut slate already locked in another browser tab, choose "— my song —" — the error line must appear AND the dropdown must snap back to the server's true value rather than sitting on "— my song —".

Stop the server with `TaskStop`, **not `pkill`** (pkill has matched the agent's own shell here before).

- [ ] **Step 6: Commit**

```bash
git add ui/src/lib/components/GuessWorkspace.svelte
git commit -m "feat(guessing): mark-first own-song control in the gut phase"
```

---

### Task 5: `VotingLabSongRow`'s mine toggle becomes read-only display

**Why this exists:** after Task 4 there would be **two** writers of `is_mine` with different semantics — the new exclusive one, and the row's whole-row upsert, which can mark a second song and break the §6 invariant. Leave exactly one writer.

**Files:**
- Modify: `ui/src/lib/components/VotingLabSongRow.svelte`

**Interfaces:**
- Consumes: `row.ballot.isMine` (unchanged, still read).
- Produces: nothing. `toggleMine` is removed.

- [ ] **Step 1: Read the current markup**

Open `ui/src/lib/components/VotingLabSongRow.svelte` and locate `toggleMine()` (~L97-100) and the markup that renders the "mine"/"not mine" button and the "your song" state (~L128-165). Note exactly how `isMine` currently hides the point steppers — **that behavior must survive unchanged**.

- [ ] **Step 2: Delete the writer, keep the display**

- Delete the `toggleMine()` function entirely.
- Replace the toggle `<button>` with a non-interactive label carrying the same text the "mine" state shows today, styled `font-mono text-xs tracking-widest uppercase text-fg-faint`.
- Leave the `{#if row.ballot.isMine}` branch that hides the steppers **exactly as it is**.
- Add this comment above the label so the next reader doesn't "restore" the toggle:

```svelte
<!-- Read-only. is_mine has exactly one writer — the guess tab's mark-first
     control (setIsMine, spec §6, exclusive per round). A second writer here
     could mark two songs and silently shrink the guess slate. -->
```

- [ ] **Step 3: Type-check**

Run: `cd ui && npm run check`
Expected: no new errors, and no "declared but never read" complaint left behind by the deletion.

- [ ] **Step 4: Confirm no other caller**

Run: `cd ui && grep -rn "toggleMine" src/`
Expected: **zero** hits.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/components/VotingLabSongRow.svelte
git commit -m "refactor(voting-lab): mine toggle is display-only; setIsMine is the sole writer"
```

---

### Task 6: Drop the whole-ballot copy

**Why this exists:** Matt's call — §7.7's per-song Output drawer replaces it. Removing it now keeps the transplanted component honest about its scope.

**Files:**
- Modify: `ui/src/lib/components/VotingLab.svelte`

**Interfaces:** none produced or consumed.

- [ ] **Step 1: Remove the code**

Delete from `VotingLab.svelte`: `ballotText()` (L176-195), `copied` / `copyError` state (L197-198), `copyBallot()` (L199-208), and in the markup the `<pre>` (L302), the copy `<button>` (L303-305), and the `copyError` paragraph (L306-308).

**Keep** the `<footer>` element and the `problems` list inside it (L296-301) — that is §7.6's incomplete-vote warning and it stays.

- [ ] **Step 2: Type-check and grep**

Run: `cd ui && npm run check && grep -rn "ballotText\|copyBallot" src/`
Expected: no new check errors; **zero** grep hits.

- [ ] **Step 3: Run the voting-lab suite for regressions**

Run: `cd ui && npx vitest run src/lib/voting-lab/`
Expected: PASS. (If a test referenced `ballotText`, it lived in the component and cannot have — but if the suite goes red, stop and report rather than deleting the test.)

- [ ] **Step 4: Commit**

```bash
git add ui/src/lib/components/VotingLab.svelte
git commit -m "refactor(voting-lab): drop whole-ballot copy, superseded by the §7.7 output drawer"
```

---

### Task 7: `takeCache` — keep the "Get take" result across tab switches

**Why this exists:** Task 8 mounts the vote UI conditionally (`{#if}`), matching the Guess tab's established pattern. That unmounts the row components on every tab switch, discarding `take` — an LLM result that costs money and time to regenerate. Today the component is always mounted, so this would be a real regression. A module-scoped cache fixes it without diverging from the codebase's mounting pattern, and lives in `.ts` so it is testable.

**Files:**
- Create: `ui/src/lib/voting-lab/takeCache.ts`
- Create: `ui/src/lib/voting-lab/takeCache.test.ts`
- Modify: `ui/src/lib/components/VotingLabSongRow.svelte`

**Interfaces:**
- Consumes: `VotingTakeOutput` from `$lib/predict/tasks/votingTake.js`.
- Produces:
  - `getCachedTake(roundId: number, spotifyUri: string): VotingTakeOutput | null`
  - `setCachedTake(roundId: number, spotifyUri: string, take: VotingTakeOutput): void`
  - `clearTakeCache(): void` (test hygiene only)

- [ ] **Step 1: Write the failing tests**

Create `ui/src/lib/voting-lab/takeCache.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getCachedTake, setCachedTake, clearTakeCache } from './takeCache.js';

const take = { headline: 'x' } as never; // shape is irrelevant to the cache

describe('takeCache', () => {
  beforeEach(() => clearTakeCache());

  it('returns null for an unknown song', () => {
    expect(getCachedTake(1, 'spotify:track:a')).toBeNull();
  });

  it('round-trips a take', () => {
    setCachedTake(1, 'spotify:track:a', take);
    expect(getCachedTake(1, 'spotify:track:a')).toBe(take);
  });

  // DISCRIMINATING: a cache keyed on spotifyUri alone would return round 1's
  // take for round 2 and fail this.
  it('keys on round AND song, not song alone', () => {
    setCachedTake(1, 'spotify:track:a', take);
    expect(getCachedTake(2, 'spotify:track:a')).toBeNull();
  });

  it('overwrites on regenerate', () => {
    const second = { headline: 'y' } as never;
    setCachedTake(1, 'spotify:track:a', take);
    setCachedTake(1, 'spotify:track:a', second);
    expect(getCachedTake(1, 'spotify:track:a')).toBe(second);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ui && npx vitest run src/lib/voting-lab/takeCache.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `ui/src/lib/voting-lab/takeCache.ts`:

```ts
import type { VotingTakeOutput } from '$lib/predict/tasks/votingTake.js';

/**
 * Module-scoped cache for "Get take" results, so switching away from and back
 * to the vote tab does not re-bill the LLM call. The vote UI mounts
 * conditionally (matching the guess tab's pattern), which unmounts the row
 * components on every tab switch and would otherwise discard the take.
 *
 * Deliberately in-memory only: a take is cheap to regenerate on a real page
 * load and stale takes should not outlive the session.
 */
const cache = new Map<string, VotingTakeOutput>();

const key = (roundId: number, spotifyUri: string) => `${roundId} ${spotifyUri}`;

export function getCachedTake(roundId: number, spotifyUri: string): VotingTakeOutput | null {
  return cache.get(key(roundId, spotifyUri)) ?? null;
}

export function setCachedTake(roundId: number, spotifyUri: string, take: VotingTakeOutput): void {
  cache.set(key(roundId, spotifyUri), take);
}

/** Test hygiene only — not called by application code. */
export function clearTakeCache(): void {
  cache.clear();
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd ui && npx vitest run src/lib/voting-lab/takeCache.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Wire it into the row**

In `ui/src/lib/components/VotingLabSongRow.svelte`:

Add the import:
```ts
  import { getCachedTake, setCachedTake } from '$lib/voting-lab/takeCache.js';
```

Seed the state from the cache instead of always `null`:
```ts
  let take = $state<VotingTakeOutput | null>(getCachedTake(roundId, row.song.spotifyUri));
```

And in `getTake`, populate the cache on success — change the success branch to:
```ts
      if (res.ok) {
        take = (await res.json()).output as VotingTakeOutput;
        setCachedTake(roundId, row.song.spotifyUri, take);
      } else {
```

- [ ] **Step 6: Type-check**

Run: `cd ui && npm run check`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add ui/src/lib/voting-lab/takeCache.ts ui/src/lib/voting-lab/takeCache.test.ts ui/src/lib/components/VotingLabSongRow.svelte
git commit -m "feat(voting-lab): cache Get take across remounts ahead of the tab transplant"
```

---

### Task 8: Move the embed into the tab as the vote phase

**Why this exists:** the actual transplant. Safe only now, because Tasks 1-4 gave `is_mine` a writer that does not depend on this embed.

**Files:**
- Modify: `ui/src/routes/league/[league]/season/[n]/round/[roundId]/+page.svelte`
- Modify: `ui/src/lib/components/GuessWorkspace.svelte`

**Interfaces:**
- Consumes: `VotingLab` (default export, prop `roundId: number`); `data.phase` from `WorkspaceData`.
- Produces: nothing.

- [ ] **Step 1: Remove the round-page embed**

In `ui/src/routes/league/[league]/season/[n]/round/[roundId]/+page.svelte`:
- Delete the line `<VotingLab roundId={data.round.id} />` (~L399, immediately above `<!-- Tab strip -->`).
- Delete the now-unused `import VotingLab from '$lib/components/VotingLab.svelte';` (~L9).
- **Change nothing else** — not the tab strip, not the `tabs` array, not `guessTabDisabled`.

⚠️ **Do not touch `ui/src/routes/+page.svelte`.** The home page's `{#each votingLeagues}` loop of `VotingLab` instances **stays** (spec §4a) — it is a cross-league surface with per-league persisted collapse state that the per-round tab cannot replace.

- [ ] **Step 2: Render it in the workspace at the vote phase**

In `ui/src/lib/components/GuessWorkspace.svelte`, add the import:

```ts
  import VotingLab from './VotingLab.svelte';
```

and insert, immediately **after** the closing `{/if}` of the rehearsal-controls block and **before** the `{#if gutError}` block:

```svelte
  <!-- spec §7.6: the transplanted Voting Lab is this workspace's vote phase.
       Conditional mounting matches the guess tab's own pattern; the "Get take"
       result survives the remount via takeCache. -->
  {#if data.phase === 'vote'}
    <VotingLab {roundId} />
  {/if}
```

- [ ] **Step 3: Confirm the importers are exactly what you expect**

Run: `cd ui && grep -rn "VotingLab" src/routes src/lib/components --include=*.svelte`
Expected exactly three non-definition hits: the home page's import + `{#each}` usage, and `GuessWorkspace.svelte`'s import + usage. **No hit in the round page.**

- [ ] **Step 4: Type-check**

Run: `cd ui && npm run check`
Expected: no new errors.

- [ ] **Step 5: Run the full suite**

Run: `cd ui && npx vitest run`
Expected: no *new* failures. ⚠️ **13 UI tests + 1 root test are already red on master** and are triaged in BACKLOG item 6b — compare against the pre-task baseline rather than expecting green, and do not "fix" them here.

- [ ] **Step 6: Verify in a real browser**

Same production-build recipe as Task 4, against a **copy** of `data/league.db`:
1. Round page no longer shows the Voting Lab above the tab strip — on **any** round, in any phase.
2. Home page still shows one collapsible Voting Lab per currently-voting league, collapse state intact.
3. In the Guess tab with `phase === 'vote'`, the Voting Lab renders and works: point steppers respect the budget, budget edits persist, notes/rating persist across a reload, "Draft comment" works.
4. The "mine" label in a vote row is **not clickable** and the steppers are still hidden for the marked song.
5. **The take cache:** click "Get take" on a song, switch to another tab, switch back — the take is **still there** and no second request fires (check the network panel).
6. There is no "Copy whole ballot" control anywhere.

Stop the server with `TaskStop`, not `pkill`.

- [ ] **Step 7: Commit**

```bash
git add ui/src/routes/league/\[league\]/season/\[n\]/round/\[roundId\]/+page.svelte ui/src/lib/components/GuessWorkspace.svelte
git commit -m "feat(guessing): move the Voting Lab into the guess tab as the vote phase"
```

---

## Self-Review

**Spec coverage:**
- §4a "the round-page embed goes" → Task 8. "the home-page one stays" → Task 8 Step 1's explicit prohibition.
- §4a "`is_mine` toggle MUST move into the tab first" → Tasks 1-4, sequenced **before** Task 8 precisely so no window exists where `is_mine` is unwritable.
- §6 exactly-one-own-song → Task 1's exclusivity + Task 5 removing the second writer.
- §7.1 gut picks immutable → Task 3's 409 gate and Task 4's disabled controls once locked.
- §7.6 "points against `voting_lab_budget`, save and resume, per-song up/down" → preserved unchanged by the transplant (Task 8 Step 6.3 verifies it). "AI-draftable vote comments" → preserved (verified same step). "incomplete votes raise a warning" → the `problems` list, explicitly kept in Task 6 Step 1.
- §7.6 "vote comments lock separately" → **deliberately not covered.** Matt deferred it to §7.7; recorded in Global Constraints.
- §7.7 output drawer → out of scope; Task 6 removes the whole-ballot copy it supersedes.

**Placeholder scan:** none — every code step carries real code, every test step real assertions, every verification step a real command and a stated expectation.

**Type consistency:** `setIsMine(db, roundId, spotifyUri: string | null)` is defined in Task 1 and consumed with that exact signature in Task 3. `WorkspaceMine { spotifyUri, title, artists }` is defined in Task 2 and consumed as `data.mine.title` / `data.mine.artists` in Task 4. `getCachedTake` / `setCachedTake` / `clearTakeCache` are defined in Task 7 Step 3 and used with matching arity in Steps 1 and 5. `VotingLab`'s only prop is `roundId: number`, matching Task 8's `<VotingLab {roundId} />`.

**Known open item, not a gap:** "Get take" keeps its current name and trigger. Matt flagged that both may want revisiting ("it may need some other trigger or name") but made no call, so this plan changes neither.
