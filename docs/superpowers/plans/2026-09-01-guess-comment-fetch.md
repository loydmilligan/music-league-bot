# Project B — Submitter Comment Fetch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fetch the submitter comments shown on a round's Music League voting page and store them on `ml_submissions.comment`, so the AI analysis (Project D, §7.3) has the single richest guessing signal — without ever learning who wrote them.

**Architecture:** Three layers, split so the hard part is testable offline. (1) A **pure Python parser** over saved ballot HTML, unit-tested with pytest against a real captured page — this is where all the fragile selector logic lives and it never touches the network. (2) A **thin fetcher script** that borrows the installed `cli-web-musicleague` client for its authenticated, Cloudflare-impersonating session, GETs one page, and prints JSON. (3) A **TypeScript ingestion** module that applies that JSON to the DB and records success or a failure note, so a bad scrape is data, not an exception.

**Tech Stack:** Python 3 + BeautifulSoup4 + pytest (parser & fetcher); TypeScript + Vitest + better-sqlite3 (ingestion); the `cli-web-musicleague` package, installed editable at `musicleague/agent-harness/cli_web/musicleague`.

**Spec:** `docs/superpowers/specs/2026-08-31-submitter-guessing-design.md` — §5 (anonymity is structural), §7.2 (this project), §7.3 (the consumer), §8 (data model).
**Spike (read it before Task 1 — it has the confirmed URL and the full parse recipe):** `docs/research/2026-09-01-ml-voting-page.md`

## Global Constraints

- **GET ONLY. This is the owner's real account in live leagues with real people.** The ballot div on `/vote/` is wired `hx-post="./?draft=1" hx-trigger="pointChange from:body"`. A GET is completely safe; a POST to that URL, or *any* browser that renders and interacts with the page, writes a real draft ballot to his account. **Never POST. Never drive this page in a browser.** (The CLI's own `_request` may transparently launch a headless browser to re-mint an expired session — that is the Spotify *login* flow, not this page, and is fine.)
- **Use `/l/{lid}/{rid}/vote/` and never `/-/results`.** After a round closes, `/-/results` carries the same comments **and attributes each to a named submitter**. `/vote/` is anonymous by construction. Reading `/-/results` here would hand the guessing game its own answer key and break spec §5. This is the single most important constraint in this plan.
- Comments are **sparse and optional** — 2 of 10 on the sampled round, 4 of 10 on another. Presence is gated on the wrapper `<p>`'s `x-show="true"` attribute; the `<p>` is emitted for *every* song with an empty span otherwise. A naive selector returns N empty strings.
- **Failure is non-fatal** (§7.2): "the AI proceeds with a recorded note that comments were unavailable, because a stale or failed scrape must not block the sitting."
- Python: run pytest from the repo root (`pytest.ini` lives there). TypeScript: run from `ui/` (`npx vitest run <file>`). **Watch for cwd drift — it has bitten this project repeatedly.**
- `ui/src/lib/db/schema.ts`'s SCHEMA is a PARTIAL view of the live DB; some tables are created by the bot process. Absence there does not mean absence.
- **`musicleague/` is gitignored** (`.gitignore:37`) — the CLI source and `MUSICLEAGUE.md` are untracked. Task 5 edits an untracked file on purpose; every other task's output must land in tracked paths.
- Empty `IN ()` is NOT a SQLite error in better-sqlite3 — it evaluates false. Do not "fix" it.
- 12 UI tests + 1 root test are already red on master (BACKLOG item 6b). Compare against a baseline you capture; do not attribute them to yourself and do not fix them.
- **Never `git add -A` or `git add .`** — another session has unrelated uncommitted work in this repo. Stage explicit paths only.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `tests/fixtures/ml-vote-ballot.html` | A real captured ballot, the parser's fixture | 1 |
| `scripts/lib/ml_vote_parse.py` | **Pure** HTML → song records. No network, no I/O. | 1 |
| `tests/test_ml_vote_parse.py` | pytest suite over the fixture | 1 |
| `scripts/ml-vote-comments.py` | Thin fetcher: resolve ids, GET, parse, print JSON | 2 |
| `ui/src/lib/db/schema.ts` | + `comments_error TEXT` on `guess_round_state` | 3 |
| `ui/src/lib/guessing/commentFetch.ts` (+ `.test.ts`) | Apply the payload to the DB; record success/failure | 4 |
| `musicleague/MUSICLEAGUE.md` | Route + parse recipe (spec-required; untracked file) | 5 |

---

### Task 1: The parser — pure, offline, fixture-tested

**Files:**
- Create: `tests/fixtures/ml-vote-ballot.html` (copy of a real captured page)
- Create: `scripts/lib/ml_vote_parse.py`
- Test: `tests/test_ml_vote_parse.py`

**Interfaces:**
- Consumes: nothing from other tasks. `bs4` only.
- Produces: `parse_ballot(html: str) -> list[dict]`, each dict exactly
  `{"spotify_uri": str, "title": str, "artist": str, "comment": str | None, "is_mine": bool}`.
  Task 2 calls this. `comment` is `None` when absent — never `""`.

- [ ] **Step 1: Install the fixture**

The spike saved real ballots to `.superpowers/research/voting-spike/` — a **gitignored** directory, so copy, don't reference:

```bash
mkdir -p tests/fixtures
cp .superpowers/research/voting-spike/*2372fb08*_vote.html tests/fixtures/ml-vote-ballot.html
```

That file is the live "Stranger Danger" ballot: 10 songs, 2 with comments, one marked as the owner's own. If it is missing, STOP and report — do not fetch a replacement (that is Task 2's job and this task must stay offline).

**Read `docs/research/2026-09-01-ml-voting-page.md` §3 now.** It has the exact selectors. Do not re-derive them by eye.

- [ ] **Step 2: Write the failing tests**

Create `tests/test_ml_vote_parse.py`:

```python
from pathlib import Path
import pytest
from scripts.lib.ml_vote_parse import parse_ballot

FIXTURE = Path(__file__).parent / "fixtures" / "ml-vote-ballot.html"


@pytest.fixture(scope="module")
def songs():
    return parse_ballot(FIXTURE.read_text(encoding="utf-8"))


def test_finds_every_song(songs):
    assert len(songs) == 10


def test_extracts_uri_title_artist(songs):
    by_uri = {s["spotify_uri"]: s for s in songs}
    assert all(u.startswith("spotify:track:") for u in by_uri)
    lil_nas = next(s for s in songs if "Old Town Road" in s["title"])
    assert lil_nas["artist"] == "Lil Nas X"


# DISCRIMINATING: the comment <p> is emitted for EVERY song with an empty span
# when there is no comment. A parser that selects the <p> without gating on
# x-show="true" returns 10 comments (mostly empty strings) and fails this.
def test_only_two_songs_have_comments(songs):
    with_comments = [s for s in songs if s["comment"] is not None]
    assert len(with_comments) == 2


def test_absent_comment_is_none_not_empty_string(songs):
    assert all(s["comment"] != "" for s in songs)


def test_comment_text_is_unescaped_and_stripped(songs):
    c = next(s["comment"] for s in songs if s["comment"] and "punk" in s["comment"])
    assert c.startswith("I'm hoping this crossover banger")
    assert "&#" not in c and "&amp;" not in c
    assert c == c.strip()


def test_marks_the_owners_own_song(songs):
    assert sum(1 for s in songs if s["is_mine"]) == 1


# spec §5: /vote/ is anonymous by construction and the parser must not invent
# or carry any submitter identity. This is the property that keeps the guessing
# game honest — if this ever fails, the wrong source page is being parsed.
def test_carries_no_submitter_identity(songs):
    allowed = {"spotify_uri", "title", "artist", "comment", "is_mine"}
    for s in songs:
        assert set(s) == allowed
```

- [ ] **Step 3: Run the tests to verify they fail**

Run from the repo root: `python -m pytest tests/test_ml_vote_parse.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.lib.ml_vote_parse'`.

If the import path itself is the problem (missing `__init__.py`, `pytest.ini` rootdir settings), fix the import plumbing in the way `pytest.ini` and any existing `tests/` Python files already do — do not restructure the repo's test layout.

- [ ] **Step 4: Implement the parser**

Create `scripts/lib/ml_vote_parse.py`:

```python
"""Pure parser for a Music League voting-page ballot.

Deliberately has no network and no file I/O: all the fragile selector logic
lives here so it can be tested offline against a saved page. See
docs/research/2026-09-01-ml-voting-page.md §3 for how these selectors were
established.

Anonymity (spec §5): the voting page is anonymous by construction — it carries
a comment per song URI and never names the submitter. This parser must not emit
any identity field. Do NOT repoint it at /-/results, which looks similar but
attributes every comment to a named user.
"""

from __future__ import annotations

from bs4 import BeautifulSoup


def _text(node) -> str:
    return node.get_text(strip=True) if node else ""


def parse_ballot(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    songs: list[dict] = []

    for block in soup.select("div.songs > div.song"):
        uri_input = block.select_one('input[name="uri"]')
        if not uri_input or not uri_input.get("value"):
            continue

        meta = block.select_one(".col.text-truncate.order-3")

        # The comment <p> is present for every song; x-show carries the truth.
        comment = None
        wrapper = block.select_one("p.bg-body-tertiary")
        if wrapper is not None and wrapper.get("x-show") == "true":
            span = wrapper.select_one("span.text-break.ws-pre-wrap")
            text = span.get_text().strip() if span else ""
            comment = text or None

        songs.append(
            {
                "spotify_uri": uri_input["value"],
                "title": _text(meta.select_one("h6")) if meta else "",
                "artist": _text(meta.select_one("span.d-block.text-truncate")) if meta else "",
                "comment": comment,
                "is_mine": "mine: true" in (block.get("x-data") or ""),
            }
        )

    return songs
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python -m pytest tests/test_ml_vote_parse.py -v`
Expected: PASS, 7 tests. If `test_only_two_songs_have_comments` reports 10, the `x-show` gate is not being applied — fix the parser, not the test.

- [ ] **Step 6: Mutation-test the comment gate**

Remove the `wrapper.get("x-show") == "true"` condition (keep everything else), rerun, and confirm `test_only_two_songs_have_comments` **fails**. Restore it. Report the actual failure output. This is the one property most likely to silently rot when Music League changes its markup.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/ml_vote_parse.py tests/test_ml_vote_parse.py tests/fixtures/ml-vote-ballot.html
git commit -m "feat(guessing): pure parser for the ML voting-page ballot"
```

---

### Task 2: The fetcher script

**Files:**
- Create: `scripts/ml-vote-comments.py`

**Interfaces:**
- Consumes: `parse_ballot` (Task 1); `cli_web.musicleague.core.client.MusicleagueClient` and `cli_web.musicleague.core.auth`.
- Produces: a CLI printing one JSON object to stdout:
  `{"ok": true, "league_id": str, "round_id": str, "songs": [...], "counts": {"songs": n, "comments": n}}`
  or on failure `{"ok": false, "error": "<message>"}` with **exit code 0** — the caller treats a failed scrape as data, not a crash (§7.2).

- [ ] **Step 1: Confirm the client's API before writing**

Open `musicleague/agent-harness/cli_web/musicleague/core/client.py` and confirm these still exist: `MusicleagueClient(cookies=...)`, `BASE_URL`, `_get_html(path)`, `close()`, and the context-manager methods. Also `core/auth.py`'s `get_cookies()` / `is_authenticated()`. If any differ, follow the real code and note the divergence in your report.

Note this file is **gitignored** — read it, do not modify it.

- [ ] **Step 2: Write the script**

```python
#!/usr/bin/env python3
"""Fetch submitter comments from a round's Music League voting page (spec §7.2).

  ./scripts/ml-vote-comments.py --league <lid> --round <rid>
  ./scripts/ml-vote-comments.py --round <rid>     # league auto-resolved

Borrows the installed cli-web-musicleague client purely for its authenticated,
Cloudflare-impersonating session; adds no command to that (untracked) package.

SAFETY — read before editing:
  * GET ONLY. /vote/ autosaves via hx-post on interaction. A POST here, or any
    browser that renders and clicks this page, writes a REAL DRAFT BALLOT to the
    owner's account in a live league.
  * Use /vote/ and never /-/results. Post-close, /-/results carries the same
    comments but ATTRIBUTES them to named submitters. /vote/ is anonymous by
    construction, and that anonymity is what the guessing game rests on (§5).

Always exits 0. A failure is reported as {"ok": false, "error": ...} because a
failed scrape must not block the sitting (§7.2).
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts.lib.ml_vote_parse import parse_ballot  # noqa: E402


def _fail(msg: str) -> int:
    json.dump({"ok": False, "error": msg}, sys.stdout)
    print()
    return 0


def resolve_league_id(client, round_id: str) -> str | None:
    """Find the league whose rounds list contains this round.

    The round shell has no reference to voting at all; only /-/rounds emits the
    /vote/ href. See the spike, §5 of docs/research/2026-09-01-ml-voting-page.md.
    """
    for league in client.list_leagues():
        soup = client._get_html(f"/l/{league['id']}/-/rounds")
        if soup and soup.select_one(f'a[href*="{round_id}"]'):
            return league["id"]
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--round", required=True, help="32-char ML round id")
    ap.add_argument("--league", help="32-char ML league id (auto-resolved if omitted)")
    args = ap.parse_args()

    try:
        from cli_web.musicleague.core import auth
        from cli_web.musicleague.core.client import MusicleagueClient
    except ImportError as e:
        return _fail(f"cli-web-musicleague is not importable: {e}")

    if not auth.is_authenticated():
        return _fail("Music League session expired. Run: cli-web-musicleague auth login")

    try:
        with MusicleagueClient(cookies=auth.get_cookies()) as client:
            lid = args.league or resolve_league_id(client, args.round)
            if not lid:
                return _fail(f"could not resolve a league containing round {args.round}")

            soup = client._get_html(f"/l/{lid}/{args.round}/vote/")
            if soup is None:
                return _fail(f"voting page fetch failed for {lid}/{args.round}")

            songs = parse_ballot(str(soup))
            if not songs:
                return _fail("voting page parsed to zero songs — markup may have changed")

            json.dump(
                {
                    "ok": True,
                    "league_id": lid,
                    "round_id": args.round,
                    "songs": songs,
                    "counts": {
                        "songs": len(songs),
                        "comments": sum(1 for s in songs if s["comment"]),
                    },
                },
                sys.stdout,
            )
            print()
            return 0
    except Exception as e:  # noqa: BLE001 — a failed scrape is data, not a crash
        return _fail(f"{type(e).__name__}: {e}")


if __name__ == "__main__":
    raise SystemExit(main())
```

⚠️ `client.list_leagues()` is a **guess at the method name.** Step 1 told you to read the real client — use whatever it actually exposes for enumerating the user's leagues, and if there is no such method, fetch `/home/-/currentLeagues` via `_get_html` and pull ids with the client's own `_extract_league_id`. Report what you used.

- [ ] **Step 3: Verify against the live site — GET only**

```bash
chmod +x scripts/ml-vote-comments.py
python3 scripts/ml-vote-comments.py \
  --league 71598b6952064ca4afe4baf437495604 \
  --round 2372fb08b6364ce4ab02726eac379efb | head -c 400
```

Expected: `{"ok": true, ...` with `"counts": {"songs": 10, "comments": 2}` — matching the fixture, from the live page.

Then verify auto-resolution by omitting `--league`. Then verify graceful failure with a bogus round id: expect `{"ok": false, ...}` **and exit code 0** (check with `echo $?`).

**Keep it to a handful of requests.** Do not sweep the league's history.

- [ ] **Step 4: Commit**

```bash
git add scripts/ml-vote-comments.py
git commit -m "feat(guessing): GET-only fetcher for ML voting-page comments"
```

---

### Task 3: Schema — somewhere to record a failed fetch

**Files:**
- Modify: `ui/src/lib/db/schema.ts`
- Test: `ui/src/lib/guessing/schema.test.ts`

**Why:** `guess_round_state` already has `comments_fetched_at TEXT`, but §7.2's "a recorded note that comments were unavailable" has no home — there is no failure-note column anywhere in the guessing tables.

**Interfaces:**
- Produces: `guess_round_state.comments_error TEXT` (nullable). Task 4 writes it.

- [ ] **Step 1: Write the failing test**

Add to `ui/src/lib/guessing/schema.test.ts`, following the shape of the tests already there:

```ts
it('guess_round_state can record why a comment fetch failed', () => {
  const { db } = seedRound();
  db.prepare(
    `INSERT INTO guess_round_state (round_id, updated_at, comments_error)
     VALUES (1, '2026-01-01T00:00:00Z', 'session expired')`,
  ).run();
  const row = db.prepare('SELECT comments_error FROM guess_round_state WHERE round_id = 1').get() as
    { comments_error: string | null };
  expect(row.comments_error).toBe('session expired');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ui && npx vitest run src/lib/guessing/schema.test.ts`
Expected: FAIL — `SqliteError: table guess_round_state has no column named comments_error`.

- [ ] **Step 3: Add the column**

In `ui/src/lib/db/schema.ts`, in the `guess_round_state` definition, immediately after `comments_fetched_at TEXT,`:

```sql
    -- §7.2: a failed or stale scrape must not block the sitting, so the failure
    -- is recorded rather than thrown. NULL alongside a NULL comments_fetched_at
    -- means "never attempted"; NULL alongside a set fetched_at means "succeeded".
    comments_error TEXT,
```

**Check how this repo applies schema changes to the existing live DB** before assuming the `CREATE TABLE` edit is sufficient — look for a migrations mechanism or an idempotent `ALTER TABLE` pattern alongside the schema, and follow whichever already exists. If there is none, say so in your report rather than inventing one; a new column on an existing table needs an `ALTER` for `data/league.db`.

- [ ] **Step 4: Run the test to verify it passes, then the suite**

Run: `cd ui && npx vitest run src/lib/guessing/`
Expected: PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/db/schema.ts ui/src/lib/guessing/schema.test.ts
git commit -m "feat(guessing): record why a comment fetch failed"
```

---

### Task 4: Ingestion — apply the payload to the DB

**Files:**
- Create: `ui/src/lib/guessing/commentFetch.ts`
- Test: `ui/src/lib/guessing/commentFetch.test.ts`

**Interfaces:**
- Consumes: `guess_round_state.comments_error` (Task 3); the fetcher's JSON shape (Task 2).
- Produces:
  ```ts
  export interface FetchedSong { spotifyUri: string; comment: string | null }
  export interface CommentPayload {
    ok: boolean; error?: string; songs?: FetchedSong[];
  }
  export interface ApplyResult { updated: number; unmatched: string[] }
  export function applyComments(
    db: Database.Database, roundId: number, payload: CommentPayload, now: string,
  ): ApplyResult;
  ```

- [ ] **Step 1: Write the failing tests**

Create `ui/src/lib/guessing/commentFetch.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { seedRound } from './fixtures.js';
import { applyComments } from './commentFetch.js';

const NOW = '2026-09-01T00:00:00Z';

describe('applyComments', () => {
  it('writes comments onto the matching submissions', () => {
    const { db, songs } = seedRound({ songCount: 3 });
    const res = applyComments(db, 1, {
      ok: true,
      songs: [{ spotifyUri: songs[1], comment: 'a real comment' }],
    }, NOW);
    expect(res.updated).toBe(1);
    const row = db.prepare(
      'SELECT comment FROM ml_submissions WHERE round_id = 1 AND spotify_uri = ?',
    ).get(songs[1]) as { comment: string | null };
    expect(row.comment).toBe('a real comment');
  });

  // DISCRIMINATING: song 0 gets no comment in the payload. An implementation
  // that writes NULL for every song (rather than only the ones it was given)
  // would wipe an existing comment and fail this.
  it('leaves songs absent from the payload untouched', () => {
    const { db, songs } = seedRound({ songCount: 3 });
    db.prepare('UPDATE ml_submissions SET comment = ? WHERE round_id = 1 AND spotify_uri = ?')
      .run('pre-existing', songs[0]);
    applyComments(db, 1, { ok: true, songs: [{ spotifyUri: songs[1], comment: 'x' }] }, NOW);
    const row = db.prepare(
      'SELECT comment FROM ml_submissions WHERE round_id = 1 AND spotify_uri = ?',
    ).get(songs[0]) as { comment: string | null };
    expect(row.comment).toBe('pre-existing');
  });

  it('stamps comments_fetched_at and clears any prior error on success', () => {
    const { db, songs } = seedRound({ songCount: 2 });
    applyComments(db, 1, { ok: false, error: 'boom' }, NOW);
    applyComments(db, 1, { ok: true, songs: [{ spotifyUri: songs[0], comment: 'c' }] }, NOW);
    const s = db.prepare(
      'SELECT comments_fetched_at, comments_error FROM guess_round_state WHERE round_id = 1',
    ).get() as { comments_fetched_at: string | null; comments_error: string | null };
    expect(s.comments_fetched_at).toBe(NOW);
    expect(s.comments_error).toBeNull();
  });

  // §7.2: a failed scrape is recorded, never thrown.
  it('records a failure without throwing and without stamping fetched_at', () => {
    const { db } = seedRound({ songCount: 2 });
    expect(() => applyComments(db, 1, { ok: false, error: 'session expired' }, NOW)).not.toThrow();
    const s = db.prepare(
      'SELECT comments_fetched_at, comments_error FROM guess_round_state WHERE round_id = 1',
    ).get() as { comments_fetched_at: string | null; comments_error: string | null };
    expect(s.comments_fetched_at).toBeNull();
    expect(s.comments_error).toBe('session expired');
  });

  it('reports uris it could not match rather than failing', () => {
    const { db } = seedRound({ songCount: 2 });
    const res = applyComments(db, 1, {
      ok: true, songs: [{ spotifyUri: 'spotify:track:ghost', comment: 'c' }],
    }, NOW);
    expect(res.updated).toBe(0);
    expect(res.unmatched).toEqual(['spotify:track:ghost']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ui && npx vitest run src/lib/guessing/commentFetch.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `ui/src/lib/guessing/commentFetch.ts`:

```ts
import type Database from 'better-sqlite3';

export interface FetchedSong { spotifyUri: string; comment: string | null }
export interface CommentPayload { ok: boolean; error?: string; songs?: FetchedSong[] }
export interface ApplyResult { updated: number; unmatched: string[] }

/**
 * Apply a voting-page scrape to the round (spec §7.2).
 *
 * A failed scrape is recorded, never thrown: the AI proceeds with a note that
 * comments were unavailable, because a stale or failed scrape must not block
 * the sitting. Only songs actually present in the payload are written — a song
 * whose submitter left no visible comment is absent from it, and must not have
 * an existing comment erased.
 */
export function applyComments(
  db: Database.Database,
  roundId: number,
  payload: CommentPayload,
  now: string,
): ApplyResult {
  const ensureState = db.prepare(
    `INSERT INTO guess_round_state (round_id, updated_at) VALUES (?, ?)
     ON CONFLICT(round_id) DO NOTHING`,
  );

  if (!payload.ok) {
    db.transaction(() => {
      ensureState.run(roundId, now);
      db.prepare(
        `UPDATE guess_round_state SET comments_error = ?, updated_at = ? WHERE round_id = ?`,
      ).run(payload.error ?? 'comment fetch failed', now, roundId);
    })();
    return { updated: 0, unmatched: [] };
  }

  const songs = payload.songs ?? [];
  const unmatched: string[] = [];
  let updated = 0;

  db.transaction(() => {
    ensureState.run(roundId, now);
    const write = db.prepare(
      `UPDATE ml_submissions SET comment = ?
        WHERE round_id = ? AND spotify_uri = ?`,
    );
    for (const s of songs) {
      const info = write.run(s.comment, roundId, s.spotifyUri);
      if (info.changes === 0) unmatched.push(s.spotifyUri);
      else updated += info.changes;
    }
    db.prepare(
      `UPDATE guess_round_state
          SET comments_fetched_at = ?, comments_error = NULL, updated_at = ?
        WHERE round_id = ?`,
    ).run(now, now, roundId);
  })();

  return { updated, unmatched };
}
```

- [ ] **Step 4: Run to verify it passes, then the suite**

Run: `cd ui && npx vitest run src/lib/guessing/`
Expected: PASS, no regressions against your captured baseline.

- [ ] **Step 5: Mutation-test the "leaves songs untouched" guarantee**

In a **disposable git worktree** (never the shared checkout): change the write to clear every song in the round first (e.g. run `UPDATE ml_submissions SET comment = NULL WHERE round_id = ?` before the loop), rerun the file, and confirm `leaves songs absent from the payload untouched` **fails**. Remove the worktree and confirm it is gone. Report the actual failure output.

- [ ] **Step 6: Commit**

```bash
git add ui/src/lib/guessing/commentFetch.ts ui/src/lib/guessing/commentFetch.test.ts
git commit -m "feat(guessing): apply scraped comments, recording failure as data"
```

---

### Task 5: Document the route (spec-required)

**Files:**
- Modify: `musicleague/MUSICLEAGUE.md` — ⚠️ an **untracked, gitignored** file. Editing it is deliberate here; it is where this project's ML route map lives, and spec §7.2 explicitly requires extending it. **Nothing in this task gets committed.**

- [ ] **Step 1: Add the two routes to the Read endpoints table**

Match the table's existing column format exactly:

```
| GET | `/l/{lid}/{rid}/vote/` | full page | voting ballot: songs + submitter comments (anonymous) |
| GET | `/l/{lid}/-/vote-status/{rid}` | HTML fragment | done/waiting avatars for voting |
```

- [ ] **Step 2: Add the parse recipes**

Copy the two bullets from `docs/research/2026-09-01-ml-voting-page.md` §3 — "Voting ballot" and "Vote status" — into the "Parsing recipes" section, matching the surrounding bullets' style.

- [ ] **Step 3: Add the gotchas**

In the Notes/gotchas section, add:
- `/vote/` serves the full ballot for **completed** rounds too, not only during the window.
- `/vote/` is a POST target wired to autosave a draft ballot on interaction — **GET only, never drive it in a browser.**
- `/-/results` is empty during voting, and after close it carries the same comments **but attributed to named submitters** — the opposite of `/vote/`'s anonymity.
- The comment `<p>` is emitted for every song; presence is gated on `x-show="true"`.
- `/vote/` is discoverable only from `/l/{lid}/-/rounds`; the round shell never references voting.

- [ ] **Step 4: Verify, do not commit**

Confirm the file still renders as valid Markdown and that `git status --short` shows **no change** (the path is gitignored). Note in your report that this task's output is intentionally unversioned, and reference the BACKLOG entry about the unversioned `musicleague/` CLI source.

---

## Self-Review

**Spec coverage:**
- §7.2 "a new CLI capability that logs into Music League with Matt's session, drives a headless browser to the round's voting page, and parses the per-song submitter comments" → Tasks 1+2, **with a deliberate deviation**: the spike proved a headless browser is unnecessary (plain authenticated GET, no Cloudflare challenge) *and* actively dangerous (the page autosaves a draft ballot on interaction). Plain HTTP is both simpler and safer, so the plan does not build the browser drive the spec anticipated. Recorded here rather than silently diverging.
- §7.2 "Runs before §7.3 and its output is an input to it" → the payload lands on `ml_submissions.comment`, which `horizon.ts:visibleSubmissions` already surfaces to the workspace and which Project D will read. No new wiring needed.
- §7.2 "Failure is non-fatal … with a recorded note" → Task 3's column, Task 4's failure path, and the fetcher's always-exit-0 contract.
- §7.2 "Requires extending `musicleague/MUSICLEAGUE.md`" → Task 5.
- §5 anonymity → the `/vote/`-only constraint, and Task 1's `test_carries_no_submitter_identity`.
- **Not covered, deliberately:** scheduling/automation (nothing calls the fetcher on a timer yet) and any UI surface for triggering or displaying a fetch. §7.2 defines the capability, not its trigger; wiring it to the `voting_started` event or to a button is follow-on work and is called out here so it is not mistaken for an oversight.

**Placeholder scan:** one flagged unknown remains by design — `client.list_leagues()` in Task 2 is explicitly marked as a guess, with the instruction to read the real client and a named fallback. Everything else is real code against verified selectors.

**Type consistency:** `parse_ballot` emits snake_case (`spotify_uri`, `is_mine`) as Python; `applyComments` consumes camelCase (`spotifyUri`). **These do not match.** The boundary is JSON crossing from Python to TypeScript, so Task 4's consumer must either receive a converted payload or the eventual caller must map the keys. Task 4's tests use camelCase and define the TS contract; whoever wires the two together owns the conversion. Flagged rather than papered over — it is a real seam and it has no task yet.
