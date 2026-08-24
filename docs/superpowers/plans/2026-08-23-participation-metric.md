# Participation Metric Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an internal per-(league, round, player) participation vector that drives digest targeting, plus a derived composite scalar and a per-round review report.

**Architecture:** Extend the existing `scripts/digest-qa/` Python tooling. Round-window and player-identity resolution move into a shared module that both the existing `chat_participation.py` and the new `participation.py` import, so their answers reconcile by construction. Facts are stored in a new `player_participation` table; the composite score is computed on read from a versioned weight table, so re-weighting corrects history rather than corrupting it.

**Tech Stack:** Python 3 (stdlib only — `sqlite3`, `re`, `datetime`, `argparse`, `json`), pytest for tests, SQLite (`data/league.db`).

**Spec:** `docs/superpowers/specs/2026-08-23-participation-metric-design.md`

## Global Constraints

- **Everything is scoped to (league, round). Nothing is pooled across groups.** A burst never spans groups; percentiles are within-league; a player in two leagues gets two independent rows per round.
- **Store the vector, derive the scalar.** Never persist a composite score.
- **Internal only.** No output of this project may be rendered into a digest section. Facts may inform copy; numbers never ship.
- **Stdlib only.** No new Python runtime dependencies. `pytest` is dev-only.
- **All timestamps are stored as `…Z` UTC** after Task 2. Local time is always UTC−7 (PDT) for the affected range 2026-05-06 → 2026-07-23.
- **`data/league.db` must be backed up before any destructive UPDATE** — `cp data/league.db data/league.db.bak-<task>-$(date +%s)`.
- **Never run `python3` bare.** The PATH `python3` resolves to an unrelated project's venv (`/home/loydmilligan/Projects/ttstt/venv`). Always use `.venv-digestqa/bin/python` created in Task 1.

---

## File Structure

| file | responsibility |
|---|---|
| `pytest.ini` | test discovery rooted at `scripts/digest-qa/tests/` |
| `scripts/digest-qa/tests/conftest.py` | fixture DB builder — an in-memory schema + row factory used by every test. **No `__init__.py` in this dir** — pytest only puts the test dir on `sys.path` when it is not a package, and `from conftest import ...` breaks if you add one. |
| `scripts/digest-qa/league_context.py` | **shared module.** League/season lookup, chat group mapping, identity resolution, message dedupe, round-window computation |
| `scripts/digest-qa/chat_participation.py` | *modified* — same output, now importing `league_context` |
| `scripts/digest-qa/participation_dims.py` | pure dimension functions: ballot, chat volume, chat kind |
| `scripts/digest-qa/participation_convo.py` | burst detection, elicited, temporal overlap |
| `scripts/digest-qa/participation_score.py` | weight table, composite, percentile-among-active |
| `scripts/digest-qa/participation.py` | CLI: compute, store, backfill, `--report` |
| `scripts/digest-qa/participation_report.py` | HTML review page |
| `scripts/fix_chat_timestamps.py` | one-shot migration for Task 2 |

Dimension functions are split across three files rather than one because Tasks 5–7 are executed **in parallel by separate agents** and must not contend for the same file.

---

## Parallel Execution Map (tmux agent team)

```
Phase 0   T1  test harness                                   [SERIAL]
Phase 1   T2  timestamp fix        │ T3  shared module        [2 AGENTS]
Phase 2   T4  schema + writer skeleton                       [SERIAL]
Phase 3   T5  ballot dims │ T6 chat dims │ T7 conversation   [3 AGENTS]
Phase 4   T8  scalar + normalisation                         [SERIAL]
Phase 5   T9  report      │ T10 backfill + reconciliation    [2 AGENTS]
```

**Phase gates are hard.** Do not start a phase until every task in the prior phase is committed and green. T2 and T3 touch disjoint files (`chat_messages` rows + a migration script vs. the digest-qa modules) and are safe to run concurrently. T5/T6/T7 each own one file and consume only T3's and T4's interfaces.

Suggested tmux session: `tmux new -s partmetric`, one window per phase, one pane per parallel task.

---

## Task 1: Python test harness

**Files:**
- Create: `pytest.ini`
- Create: `scripts/digest-qa/tests/conftest.py`
- Create: `scripts/digest-qa/tests/test_harness.py`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: pytest fixture `fixture_db` — an open `sqlite3.Connection` with `row_factory = sqlite3.Row`, containing the subset of the real schema these tools read, and a helper `add_msg(db, group, sender, text, ts)` plus `add_vote(db, round_id, voter, uri, points, comment)`.

There is no Python test infrastructure in this repo today — `tests/` is entirely TypeScript/vitest. This task creates it.

- [ ] **Step 1: Create the dev venv**

```bash
cd ~/Projects/music-league-bot
python3 -m venv .venv-digestqa
.venv-digestqa/bin/pip install --quiet pytest
.venv-digestqa/bin/python -c "import sys; print(sys.executable)"
```

Expected: prints a path inside `.venv-digestqa`, NOT inside `Projects/ttstt`.

- [ ] **Step 2: Ignore the venv**

Append to `.gitignore`:

```
# Dev-only venv for the Python digest-qa tools (pytest). Stdlib-only at runtime.
.venv-digestqa/
```

- [ ] **Step 3: Create `pytest.ini`**

```ini
[pytest]
testpaths = scripts/digest-qa/tests
python_files = test_*.py
addopts = -q
```

- [ ] **Step 4: Write `scripts/digest-qa/tests/conftest.py`**

```python
"""Fixture DB for the digest-qa Python tools.

Only the tables these tools read are created. Kept deliberately small: a test
that needs a column should add it here rather than reaching for the real
data/league.db, which is production data and must never be opened by a test.
"""
import os
import sqlite3
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SCHEMA = """
CREATE TABLE leagues (id INTEGER PRIMARY KEY, slug TEXT, name TEXT, digest_mode TEXT);
CREATE TABLE seasons (id INTEGER PRIMARY KEY, league_id INTEGER, season_number INTEGER);
CREATE TABLE rounds (id INTEGER PRIMARY KEY, season_id INTEGER, name TEXT,
                     submission_deadline TEXT, voting_deadline TEXT);
CREATE TABLE competitors (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE player_identities (id INTEGER PRIMARY KEY, player_id INTEGER,
                     league_id INTEGER, identity_type TEXT, identifier TEXT);
CREATE TABLE ml_submissions (id INTEGER PRIMARY KEY, round_id INTEGER,
                     competitor_id INTEGER, spotify_uri TEXT, title TEXT,
                     artists TEXT, comment TEXT, created_at TEXT);
CREATE TABLE votes (id INTEGER PRIMARY KEY, round_id INTEGER, voter_id INTEGER,
                     spotify_uri TEXT, points INTEGER, comment TEXT);
CREATE TABLE chat_messages (id TEXT PRIMARY KEY, platform TEXT, group_name TEXT,
                     group_key TEXT, sender TEXT, text TEXT, ts TEXT,
                     msg_hash TEXT, captured_at TEXT, sender_handle TEXT);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
"""


@pytest.fixture
def fixture_db():
    db = sqlite3.connect(":memory:")
    db.row_factory = sqlite3.Row
    db.executescript(SCHEMA)
    db.execute("INSERT INTO leagues VALUES (1,'test-league','Test League','hil')")
    db.execute("INSERT INTO seasons VALUES (10,1,1)")
    db.execute(
        "INSERT INTO settings VALUES ('chat_league_group_map', ?)",
        ('{"test-league": "Test Group"}',),
    )
    yield db
    db.close()


def add_msg(db, sender, text, ts, group="Test Group"):
    """Insert one chat message. `ts` is an ISO string ending in Z."""
    n = db.execute("SELECT COUNT(*) FROM chat_messages").fetchone()[0]
    db.execute(
        "INSERT INTO chat_messages (id, platform, group_name, sender, text, ts, msg_hash, captured_at)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (f"m{n}", "whatsapp", group, sender, text, ts, f"h{n}", ts),
    )


def add_round(db, round_id, voting_deadline, season_id=10, name="R"):
    db.execute(
        "INSERT INTO rounds (id, season_id, name, submission_deadline, voting_deadline)"
        " VALUES (?,?,?,?,?)",
        (round_id, season_id, name, None, voting_deadline),
    )


def add_vote(db, round_id, voter_id, uri, points, comment=""):
    n = db.execute("SELECT COUNT(*) FROM votes").fetchone()[0]
    db.execute(
        "INSERT INTO votes (id, round_id, voter_id, spotify_uri, points, comment) VALUES (?,?,?,?,?,?)",
        (n, round_id, voter_id, uri, points, comment),
    )
```

- [ ] **Step 5: Write the harness test**

`scripts/digest-qa/tests/test_harness.py`:

```python
from conftest import add_msg, add_round


def test_fixture_db_has_league(fixture_db):
    row = fixture_db.execute("SELECT slug FROM leagues WHERE id=1").fetchone()
    assert row["slug"] == "test-league"


def test_helpers_insert_rows(fixture_db):
    add_round(fixture_db, 1, "2026-01-08T07:00:00Z")
    add_msg(fixture_db, "Alice", "hello", "2026-01-02T19:00:00Z")
    assert fixture_db.execute("SELECT COUNT(*) FROM chat_messages").fetchone()[0] == 1
    assert fixture_db.execute("SELECT COUNT(*) FROM rounds").fetchone()[0] == 1
```

- [ ] **Step 6: Run the tests**

Run: `.venv-digestqa/bin/pytest`
Expected: `2 passed`

- [ ] **Step 7: Commit**

```bash
git add pytest.ini scripts/digest-qa/tests/ .gitignore
git commit -m "test(digest-qa): pytest harness and fixture DB for the Python tools"
```

---

## Task 2: Timestamp normalisation *(Phase 1, parallel with T3)*

**Files:**
- Create: `scripts/fix_chat_timestamps.py`
- Create: `scripts/digest-qa/tests/test_fix_chat_timestamps.py`
- Modify: `docs/plans/digest-quality-program.md` (record the migration)

**Interfaces:**
- Consumes: nothing.
- Produces: `classify_row(group_name: str, ts: str) -> str` returning `"relay"`, `"export_needs_shift"`, or `"export_correct"`; and `corrected_ts(ts: str, kind: str) -> str` returning a `…Z` UTC string.

Spec §4. This blocks Tasks 6 and 7 — `days_active` and every burst dimension are wrong until it lands.

The rule, established from three messages Matt dated and confirmed against per-group hour distributions:

| group | stored format | rule |
|---|---|---|
| any | `…Z` | already true UTC — `relay` |
| `Music League chat for Second Best and Friends` | `…+00:00` | stored value is **local** — add 7h |
| `Hip jammers` | `…+00:00` | stored value is **local** — add 7h |
| `Boarz II Men - Music League` | `…+00:00` | already true UTC — leave |

- [ ] **Step 1: Write the failing test**

`scripts/digest-qa/tests/test_fix_chat_timestamps.py`:

```python
import pytest
from fix_chat_timestamps import classify_row, corrected_ts

SB = "Music League chat for Second Best and Friends"
BOARZ = "Boarz II Men - Music League"
HIP = "Hip jammers"


@pytest.mark.parametrize("group,ts,expected", [
    (SB, "2026-05-06T22:17:00Z", "relay"),
    (SB, "2026-05-06T22:17:00+00:00", "export_needs_shift"),
    (HIP, "2026-05-10T19:00:00+00:00", "export_needs_shift"),
    (BOARZ, "2026-07-15T03:47:00+00:00", "export_correct"),
    (BOARZ, "2026-07-15T03:47:00Z", "relay"),
])
def test_classify_row(group, ts, expected):
    assert classify_row(group, ts) == expected


def test_shift_adds_seven_hours_and_normalises_format():
    # Matt's ground truth: stored 22:17 was actually 10:17pm local,
    # so the stored value IS local and true UTC is 05:17 the next day.
    assert corrected_ts("2026-05-06T22:17:00+00:00", "export_needs_shift") == "2026-05-07T05:17:00Z"


def test_correct_export_is_only_reformatted():
    assert corrected_ts("2026-07-15T03:47:00+00:00", "export_correct") == "2026-07-15T03:47:00Z"


def test_relay_row_is_unchanged():
    assert corrected_ts("2026-08-20T02:41:00Z", "relay") == "2026-08-20T02:41:00Z"
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `.venv-digestqa/bin/pytest scripts/digest-qa/tests/test_fix_chat_timestamps.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'fix_chat_timestamps'`

- [ ] **Step 3: Write the implementation**

`scripts/fix_chat_timestamps.py`:

```python
#!/usr/bin/env python3
"""One-shot migration: normalise chat_messages.ts to true UTC.

Two ingest paths disagreed. Live relay rows (…Z) were always true UTC. Pixel 9
export backfill rows (…+00:00) had the PDT correction applied on the Boarz pass
and NOT on the Second Best / Hip Jammers passes, so those store local time
wearing a UTC label.

Established from three messages Matt dated on 2026-08-23 and confirmed against
per-group hour distributions: correcting Second Best takes its share of messages
posted 2-8am local from 47% to 3%.

All affected rows fall in 2026-05-06..2026-07-23, entirely within PDT (UTC-7),
so a flat 7h shift is correct and there is no DST edge case.

Usage: python scripts/fix_chat_timestamps.py [--db data/league.db] [--apply]
Without --apply it reports what it would change and touches nothing.
"""
import argparse
import sqlite3
import sys
from datetime import datetime, timedelta

PDT_OFFSET_HOURS = 7

# Groups whose EXPORT-path rows stored local time labelled UTC.
NEEDS_SHIFT = {
    "Music League chat for Second Best and Friends",
    "Hip jammers",
}


def classify_row(group_name: str, ts: str) -> str:
    if ts.endswith("Z"):
        return "relay"
    return "export_needs_shift" if group_name in NEEDS_SHIFT else "export_correct"


def corrected_ts(ts: str, kind: str) -> str:
    base = ts.replace("+00:00", "").replace("Z", "")[:19]
    dt = datetime.fromisoformat(base)
    if kind == "export_needs_shift":
        dt += timedelta(hours=PDT_OFFSET_HOURS)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="data/league.db")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    db = sqlite3.connect(args.db)
    db.row_factory = sqlite3.Row

    cols = {r["name"] for r in db.execute("PRAGMA table_info(chat_messages)")}
    if "source_path" not in cols:
        if args.apply:
            db.execute("ALTER TABLE chat_messages ADD COLUMN source_path TEXT")
        print("source_path column: " + ("added" if args.apply else "MISSING (would add)"))

    rows = db.execute("SELECT id, group_name, ts FROM chat_messages").fetchall()
    counts = {"relay": 0, "export_needs_shift": 0, "export_correct": 0}
    updates = []
    for r in rows:
        kind = classify_row(r["group_name"], r["ts"])
        counts[kind] += 1
        new_ts = corrected_ts(r["ts"], kind)
        source = "relay" if kind == "relay" else "export"
        if new_ts != r["ts"] or not args.apply:
            updates.append((new_ts, source, r["id"]))

    for kind, n in counts.items():
        print(f"  {kind:20} {n:6}")

    if not args.apply:
        print(f"\ndry run — {len(updates)} rows would be rewritten. Re-run with --apply.")
        return

    db.executemany("UPDATE chat_messages SET ts=?, source_path=? WHERE id=?", updates)
    db.commit()
    print(f"\napplied to {len(updates)} rows.")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the tests**

Run: `.venv-digestqa/bin/pytest scripts/digest-qa/tests/test_fix_chat_timestamps.py -v`
Expected: `8 passed`

- [ ] **Step 5: Back up the database, then dry-run**

```bash
cp data/league.db data/league.db.bak-tsfix-$(date +%s)
.venv-digestqa/bin/python scripts/fix_chat_timestamps.py --db data/league.db
```

Expected: roughly `relay 3447+`, `export_needs_shift 1366`, `export_correct 288`. **If `export_needs_shift` is not 1366, stop and report** — the group names may have drifted.

- [ ] **Step 6: Apply**

```bash
.venv-digestqa/bin/python scripts/fix_chat_timestamps.py --db data/league.db --apply
```

- [ ] **Step 7: Verify against ground truth**

```bash
.venv-digestqa/bin/python - <<'PY'
import sqlite3
from datetime import datetime, timedelta
db = sqlite3.connect('data/league.db')
checks = [
    ("Hey Friends - figured it might be ideal", "2026-05-06 22:17"),
    ("Layous takes the lead", "2026-06-02 10:52"),
    ("yes - i thought of it 2 seconds ago", "2026-07-14 20:47"),
]
for needle, expected_local in checks:
    ts = db.execute("SELECT ts FROM chat_messages WHERE text LIKE ? LIMIT 1", (needle + '%',)).fetchone()
    if not ts:
        print(f"NOT FOUND: {needle}"); continue
    local = datetime.fromisoformat(ts[0].replace('Z', '')) - timedelta(hours=7)
    got = local.strftime('%Y-%m-%d %H:%M')
    print(f"{'OK ' if got == expected_local else 'BAD'} {needle[:40]:42} got {got}  want {expected_local}")
PY
```

Expected: three `OK` lines.

- [ ] **Step 8: Verify no group still claims a 2–8am peak**

```bash
.venv-digestqa/bin/python - <<'PY'
import sqlite3, collections
from datetime import datetime, timedelta
db = sqlite3.connect('data/league.db')
for (g,) in db.execute("SELECT DISTINCT group_name FROM chat_messages"):
    hrs = [ (datetime.fromisoformat(t.replace('Z',''))-timedelta(hours=7)).hour
            for (t,) in db.execute("SELECT ts FROM chat_messages WHERE group_name=?", (g,)) ]
    if len(hrs) < 50: continue
    night = sum(1 for h in hrs if 2 <= h <= 8)/len(hrs)*100
    print(f"{'OK ' if night < 15 else 'BAD'} {g[:44]:46} {len(hrs):5} msgs  {night:5.1f}% at 2-8am")
PY
```

Expected: every line `OK`.

- [ ] **Step 9: Record the migration and commit**

Add to `docs/plans/digest-quality-program.md` under WS1, then:

```bash
git add scripts/fix_chat_timestamps.py scripts/digest-qa/tests/test_fix_chat_timestamps.py docs/plans/digest-quality-program.md
git commit -m "fix(chat): normalise backfilled timestamps to true UTC

Pixel 9 export rows stored local time labelled UTC for Second Best and Hip
Jammers (1,366 rows) but correct UTC for Boarz (288). Silently corrupted
days_active and every burst-derived dimension. Adds source_path so the next
manual backfill records its provenance."
```

---

## Task 3: Shared league-context module *(Phase 1, parallel with T2)*

**Files:**
- Create: `scripts/digest-qa/league_context.py`
- Create: `scripts/digest-qa/tests/test_league_context.py`
- Modify: `scripts/digest-qa/chat_participation.py:33-95`

**Interfaces:**
- Consumes: nothing.
- Produces — every later task imports these:
  - `iso(ts: str) -> str`
  - `norm_sender(s: str) -> str`
  - `league_id_for(db, slug: str) -> int`
  - `current_season(db, league_id: int) -> int`
  - `chat_group_for(db, slug: str) -> str`
  - `identity_resolver(db, league_id: int) -> Callable[[str], str]`
  - `deduped_messages(db, group: str) -> list[tuple[str, str, str]]` — `(ts, resolved_sender, text)`, sorted by ts, relay truncation removed
  - `round_windows(db, season_id: int) -> list[RoundWindow]` where `RoundWindow` is a `NamedTuple(round_id: int, name: str, start: str, end: str)`

- [ ] **Step 1: Write the failing test**

`scripts/digest-qa/tests/test_league_context.py`:

```python
from conftest import add_msg, add_round
import league_context as lc


def test_norm_sender_strips_push_prefix():
    assert lc.norm_sender("~ Conor J") == "Conor J"
    assert lc.norm_sender("Matt Mariani") == "Matt Mariani"


def test_iso_normalises_offset_to_z():
    assert lc.iso("2026-05-06T22:17:00+00:00") == "2026-05-06T22:17:00Z"


def test_league_and_group_lookup(fixture_db):
    assert lc.league_id_for(fixture_db, "test-league") == 1
    assert lc.chat_group_for(fixture_db, "test-league") == "Test Group"


def test_identity_resolver_maps_push_name_to_player(fixture_db):
    fixture_db.execute("INSERT INTO players VALUES (5,'Sarah Black')")
    fixture_db.execute(
        "INSERT INTO player_identities (id,player_id,league_id,identity_type,identifier)"
        " VALUES (1,5,1,'whatsapp','~ Sarah')")
    resolve = lc.identity_resolver(fixture_db, 1)
    assert resolve("~ Sarah") == "Sarah Black"
    assert resolve("Sarah") == "Sarah Black"
    assert resolve("Nobody") == "Nobody"


def test_deduped_messages_keeps_longest_of_a_truncation_pair(fixture_db):
    add_msg(fixture_db, "Alice", "the full message text", "2026-01-02T19:00:00Z")
    add_msg(fixture_db, "Alice", "the full mess", "2026-01-02T19:00:00Z")
    msgs = lc.deduped_messages(fixture_db, "Test Group")
    assert len(msgs) == 1
    assert msgs[0][2] == "the full message text"


def test_round_windows_chain_deadline_to_deadline(fixture_db):
    add_round(fixture_db, 1, "2026-01-08T07:00:00Z")
    add_round(fixture_db, 2, "2026-01-15T07:00:00Z")
    w = lc.round_windows(fixture_db, 10)
    assert len(w) == 2
    assert w[1].start == "2026-01-08T07:00:00Z"
    assert w[1].end == "2026-01-15T07:00:00Z"


def test_first_round_window_falls_back_to_seven_days(fixture_db):
    add_round(fixture_db, 1, "2026-01-08T07:00:00Z")
    w = lc.round_windows(fixture_db, 10)
    assert w[0].start == "2026-01-01T07:00:00Z"
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `.venv-digestqa/bin/pytest scripts/digest-qa/tests/test_league_context.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'league_context'`

- [ ] **Step 3: Write the implementation**

`scripts/digest-qa/league_context.py`:

```python
#!/usr/bin/env python3
"""Shared league/round/identity resolution for the digest-qa Python tools.

Extracted from chat_participation.py so that every tool answering "who was
active in round N" answers identically by construction. This is the same
property that makes mention_matrix reconcile with mention_inventory for free.

Everything here is scoped to one league. Nothing pools across groups.
"""
import json
import re
import sqlite3
from datetime import datetime, timedelta
from typing import Callable, NamedTuple


def iso(ts: str) -> str:
    """Normalise an offset-suffixed timestamp to the Z form."""
    return ts.replace("+00:00", "Z")


def norm_sender(s: str) -> str:
    """"~ Name" / "~ Name" WhatsApp push-name prefixes -> bare name."""
    return re.sub(r"^~[\s  ]*", "", s).strip()


def league_id_for(db: sqlite3.Connection, slug: str) -> int:
    row = db.execute("SELECT id FROM leagues WHERE slug=?", (slug,)).fetchone()
    if not row:
        raise KeyError(f"unknown league slug {slug!r}")
    return row[0]


def current_season(db: sqlite3.Connection, league_id: int) -> int:
    row = db.execute("SELECT MAX(id) FROM seasons WHERE league_id=?", (league_id,)).fetchone()
    if not row or row[0] is None:
        raise KeyError(f"no seasons for league {league_id}")
    return row[0]


def chat_group_for(db: sqlite3.Connection, slug: str) -> str:
    row = db.execute("SELECT value FROM settings WHERE key='chat_league_group_map'").fetchone()
    if not row:
        raise KeyError("settings.chat_league_group_map is missing")
    group = json.loads(row[0]).get(slug)
    if not group:
        raise KeyError(f"no chat group mapped for {slug!r}")
    return group


def identity_resolver(db: sqlite3.Connection, league_id: int) -> Callable[[str], str]:
    """sender string -> player name, via player_identities for THIS league."""
    ident: dict[str, str] = {}
    for identifier, pname in db.execute(
        """SELECT pi.identifier, p.name FROM player_identities pi
           JOIN players p ON pi.player_id = p.id
           WHERE pi.identity_type='whatsapp' AND (pi.league_id=? OR pi.league_id IS NULL)""",
        (league_id,),
    ):
        ident[identifier] = pname
        ident[norm_sender(identifier)] = pname

    def resolve(sender: str) -> str:
        return ident.get(sender) or ident.get(norm_sender(sender)) or norm_sender(sender)

    return resolve


def deduped_messages(db: sqlite3.Connection, group: str) -> list[tuple[str, str, str]]:
    """(ts, raw_sender, text) for one group, relay truncation removed.

    The relay sometimes delivers a truncated copy of a message it already sent.
    Keyed on (sender, ts), the longest text wins.
    """
    best: dict[tuple[str, str], str] = {}
    for ts, sender, text in db.execute(
        "SELECT ts, sender, text FROM chat_messages WHERE group_name=?", (group,)
    ):
        k = (sender, iso(ts))
        if k not in best or len(text) > len(best[k]):
            best[k] = text
    return sorted((ts, sender, text) for (sender, ts), text in best.items())


class RoundWindow(NamedTuple):
    round_id: int
    name: str
    start: str
    end: str


def round_windows(db: sqlite3.Connection, season_id: int) -> list[RoundWindow]:
    """Chat window per round: previous round's voting deadline -> this one's.

    The first round of a season has no predecessor, so it falls back to seven
    days before its own deadline.
    """
    out: list[RoundWindow] = []
    prev: str | None = None
    for rid, name, vote_dl in db.execute(
        """SELECT id, name, voting_deadline FROM rounds
           WHERE season_id=? AND voting_deadline IS NOT NULL
           ORDER BY voting_deadline""",
        (season_id,),
    ):
        end = iso(vote_dl)
        if prev is None:
            start = (datetime.fromisoformat(end.rstrip("Z")) - timedelta(days=7)).strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            )
        else:
            start = prev
        out.append(RoundWindow(rid, name, start, end))
        prev = end
    return out
```

- [ ] **Step 4: Run the tests**

Run: `.venv-digestqa/bin/pytest scripts/digest-qa/tests/test_league_context.py -v`
Expected: `7 passed`

- [ ] **Step 5: Rewire `chat_participation.py` to use the module**

In `scripts/digest-qa/chat_participation.py`, delete the local `iso` and `norm_sender` definitions (lines 26–31) and the inline resolution blocks in `main()`, replacing them with:

```python
import league_context as lc

# ... inside main(), replacing the league/season/group/ident/msgs blocks:
    league_id = lc.league_id_for(db, args.league_slug)
    season = args.season or lc.current_season(db, league_id)
    group = lc.chat_group_for(db, args.league_slug)
    resolve = lc.identity_resolver(db, league_id)
    msgs = sorted((ts, resolve(sender)) for ts, sender, _ in lc.deduped_messages(db, group))
```

Add at the top of the file, above the import:

```python
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
```

- [ ] **Step 6: Prove the refactor changed no output**

```bash
git stash && .venv-digestqa/bin/python scripts/digest-qa/chat_participation.py second-best > /tmp/cp-before.txt; git stash pop
.venv-digestqa/bin/python scripts/digest-qa/chat_participation.py second-best > /tmp/cp-after.txt
diff /tmp/cp-before.txt /tmp/cp-after.txt && echo "IDENTICAL"
```

Expected: `IDENTICAL`. If Task 2 has already landed the timestamp fix, the *per-round message counts may legitimately differ* — in that case re-run the before-capture against the backup DB `data/league.db.bak-tsfix-*` and diff that instead.

- [ ] **Step 7: Commit**

```bash
git add scripts/digest-qa/league_context.py scripts/digest-qa/tests/test_league_context.py scripts/digest-qa/chat_participation.py
git commit -m "refactor(digest-qa): extract league_context shared by participation tools"
```

---

## Task 4: Storage schema and vector writer skeleton

**Files:**
- Create: `scripts/digest-qa/participation.py`
- Create: `scripts/digest-qa/tests/test_participation_store.py`

**Interfaces:**
- Consumes: `league_context` (Task 3).
- Produces:
  - `VECTOR_FIELDS: list[str]` — the canonical ordered column list, imported by Tasks 5, 6, 7, 8, 9.
  - `ensure_schema(db) -> None`
  - `store_vector(db, league_id: int, round_id: int, competitor_id: int, vec: dict) -> None`
  - `load_vectors(db, league_id: int, round_id: int) -> dict[int, dict]`

`VECTOR_FIELDS` is the contract between the three parallel dimension tasks. Every field they produce must appear here, spelled exactly this way.

- [ ] **Step 1: Write the failing test**

`scripts/digest-qa/tests/test_participation_store.py`:

```python
import participation as P


def test_vector_fields_are_the_agreed_contract():
    assert P.VECTOR_FIELDS == [
        "voted", "submitted", "vote_comments", "vote_comment_chars", "sub_comment_chars",
        "msgs", "chars", "days_active",
        "music_links", "media", "other_links",
        "bursts_joined", "group_discussions_joined", "elicited",
        "mentions_made", "mentions_received", "temporal_overlap",
        "rounds_in_league", "median_hour", "share_off_peak",
    ]


def test_store_and_load_roundtrip(fixture_db):
    P.ensure_schema(fixture_db)
    vec = {f: 0 for f in P.VECTOR_FIELDS}
    vec["msgs"] = 12
    vec["voted"] = 1
    P.store_vector(fixture_db, league_id=1, round_id=7, competitor_id=3, vec=vec)
    got = P.load_vectors(fixture_db, league_id=1, round_id=7)
    assert got[3]["msgs"] == 12
    assert got[3]["voted"] == 1


def test_store_is_idempotent(fixture_db):
    P.ensure_schema(fixture_db)
    vec = {f: 0 for f in P.VECTOR_FIELDS}
    vec["msgs"] = 5
    P.store_vector(fixture_db, 1, 7, 3, vec)
    vec["msgs"] = 9
    P.store_vector(fixture_db, 1, 7, 3, vec)
    got = P.load_vectors(fixture_db, 1, 7)
    assert len(got) == 1
    assert got[3]["msgs"] == 9


def test_two_leagues_keep_independent_rows(fixture_db):
    P.ensure_schema(fixture_db)
    vec = {f: 0 for f in P.VECTOR_FIELDS}
    vec["msgs"] = 100
    P.store_vector(fixture_db, league_id=1, round_id=7, competitor_id=3, vec=vec)
    vec["msgs"] = 4
    P.store_vector(fixture_db, league_id=2, round_id=7, competitor_id=3, vec=vec)
    assert P.load_vectors(fixture_db, 1, 7)[3]["msgs"] == 100
    assert P.load_vectors(fixture_db, 2, 7)[3]["msgs"] == 4
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `.venv-digestqa/bin/pytest scripts/digest-qa/tests/test_participation_store.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'participation'`

- [ ] **Step 3: Write the implementation**

`scripts/digest-qa/participation.py`:

```python
#!/usr/bin/env python3
"""Participation vector: storage and CLI.

Spec: docs/superpowers/specs/2026-08-23-participation-metric-design.md

Stores FACTS per (league, round, player). The composite score is deliberately
NOT stored -- it is computed on read from a weight table, so re-weighting
corrects the whole history instead of leaving it a mix of old and new opinions.
"""
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# The contract between the three parallel dimension modules. Order is canonical.
VECTOR_FIELDS = [
    # ballot
    "voted", "submitted", "vote_comments", "vote_comment_chars", "sub_comment_chars",
    # chat volume
    "msgs", "chars", "days_active",
    # chat kind
    "music_links", "media", "other_links",
    # conversation
    "bursts_joined", "group_discussions_joined", "elicited",
    "mentions_made", "mentions_received", "temporal_overlap",
    # context
    "rounds_in_league", "median_hour", "share_off_peak",
]

_COLS = ",\n  ".join(f"{f} REAL NOT NULL DEFAULT 0" for f in VECTOR_FIELDS)

DDL = f"""
CREATE TABLE IF NOT EXISTS player_participation (
  league_id     INTEGER NOT NULL,
  round_id      INTEGER NOT NULL,
  competitor_id INTEGER NOT NULL,
  {_COLS},
  computed_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (league_id, round_id, competitor_id)
);
"""


def ensure_schema(db: sqlite3.Connection) -> None:
    db.executescript(DDL)


def store_vector(db, league_id: int, round_id: int, competitor_id: int, vec: dict) -> None:
    cols = ", ".join(VECTOR_FIELDS)
    marks = ", ".join("?" for _ in VECTOR_FIELDS)
    updates = ", ".join(f"{f}=excluded.{f}" for f in VECTOR_FIELDS)
    db.execute(
        f"""INSERT INTO player_participation (league_id, round_id, competitor_id, {cols})
            VALUES (?, ?, ?, {marks})
            ON CONFLICT(league_id, round_id, competitor_id) DO UPDATE SET
              {updates},
              computed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')""",
        [league_id, round_id, competitor_id] + [vec.get(f, 0) for f in VECTOR_FIELDS],
    )


def load_vectors(db, league_id: int, round_id: int) -> dict[int, dict]:
    rows = db.execute(
        "SELECT * FROM player_participation WHERE league_id=? AND round_id=?",
        (league_id, round_id),
    ).fetchall()
    out = {}
    for r in rows:
        d = dict(r)
        out[d["competitor_id"]] = {f: d[f] for f in VECTOR_FIELDS}
    return out
```

- [ ] **Step 4: Run the tests**

Run: `.venv-digestqa/bin/pytest scripts/digest-qa/tests/test_participation_store.py -v`
Expected: `4 passed`

- [ ] **Step 5: Commit**

```bash
git add scripts/digest-qa/participation.py scripts/digest-qa/tests/test_participation_store.py
git commit -m "feat(digest-qa): player_participation schema and vector store"
```

---

## Task 5: Ballot dimensions *(Phase 3, parallel with T6 and T7)*

**Files:**
- Create: `scripts/digest-qa/participation_dims.py`
- Create: `scripts/digest-qa/tests/test_participation_dims_ballot.py`

**Interfaces:**
- Consumes: `participation.VECTOR_FIELDS` (Task 4).
- Produces: `ballot_dims(db, round_id: int) -> dict[int, dict]` — competitor_id → `{voted, submitted, vote_comments, vote_comment_chars, sub_comment_chars}`.

**You own `participation_dims.py`. Task 6 also writes to this file — coordinate: T5 appends `ballot_dims`, T6 appends `chat_volume_dims` and `chat_kind_dims`, both below the shared header. If both agents start simultaneously, T5 creates the file with the header and T6 rebases onto it.**

Spec §5.1.

- [ ] **Step 1: Write the failing test**

`scripts/digest-qa/tests/test_participation_dims_ballot.py`:

```python
from conftest import add_vote
from participation_dims import ballot_dims


def _seed(db):
    db.execute("INSERT INTO competitors VALUES (1,'Tommy')")
    db.execute("INSERT INTO competitors VALUES (2,'Sarah Z')")
    db.execute("INSERT INTO competitors VALUES (3,'Quiet Quinto')")
    db.execute(
        "INSERT INTO ml_submissions (id, round_id, competitor_id, spotify_uri, title, artists, comment, created_at)"
        " VALUES (1, 7, 1, 'uri:a', 'A', 'X', 'a long submission comment', '2026-01-01')")
    add_vote(db, 7, 1, "uri:b", 3, "a" * 100)
    add_vote(db, 7, 1, "uri:c", 1, "b" * 25)
    add_vote(db, 7, 2, "uri:a", 2, "short")
    add_vote(db, 7, 2, "uri:c", 0, "")


def test_counts_comments_and_chars(fixture_db):
    _seed(fixture_db)
    d = ballot_dims(fixture_db, 7)
    assert d[1]["vote_comments"] == 2
    assert d[1]["vote_comment_chars"] == 125
    assert d[2]["vote_comments"] == 1


def test_empty_comment_is_not_counted(fixture_db):
    _seed(fixture_db)
    assert ballot_dims(fixture_db, 7)[2]["vote_comment_chars"] == 5


def test_voted_and_submitted_flags(fixture_db):
    _seed(fixture_db)
    d = ballot_dims(fixture_db, 7)
    assert d[1]["voted"] == 1 and d[1]["submitted"] == 1
    assert d[2]["voted"] == 1 and d[2]["submitted"] == 0


def test_submission_comment_chars(fixture_db):
    _seed(fixture_db)
    assert ballot_dims(fixture_db, 7)[1]["sub_comment_chars"] == len("a long submission comment")


def test_non_participant_absent_from_result(fixture_db):
    _seed(fixture_db)
    assert 3 not in ballot_dims(fixture_db, 7)
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `.venv-digestqa/bin/pytest scripts/digest-qa/tests/test_participation_dims_ballot.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'participation_dims'`

- [ ] **Step 3: Write the implementation**

`scripts/digest-qa/participation_dims.py`:

```python
#!/usr/bin/env python3
"""Pure dimension functions for the participation vector: ballot and chat.

Each returns competitor_id -> partial vector. None of them touch the DB beyond
reading, and none of them decide anything about weighting -- these are facts.

Spec: docs/superpowers/specs/2026-08-23-participation-metric-design.md
"""
import os
import re
import sqlite3
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def ballot_dims(db: sqlite3.Connection, round_id: int) -> dict[int, dict]:
    """Spec 5.1. Anyone who voted or submitted in this round appears."""
    out: dict[int, dict] = defaultdict(
        lambda: {"voted": 0, "submitted": 0, "vote_comments": 0,
                 "vote_comment_chars": 0, "sub_comment_chars": 0})

    for cid, comment in db.execute(
        "SELECT voter_id, COALESCE(comment,'') FROM votes WHERE round_id=?", (round_id,)
    ):
        d = out[cid]
        d["voted"] = 1
        if comment.strip():
            d["vote_comments"] += 1
            d["vote_comment_chars"] += len(comment)

    for cid, comment in db.execute(
        "SELECT competitor_id, COALESCE(comment,'') FROM ml_submissions"
        " WHERE round_id=? AND competitor_id IS NOT NULL", (round_id,)
    ):
        d = out[cid]
        d["submitted"] = 1
        d["sub_comment_chars"] += len(comment)

    return dict(out)
```

- [ ] **Step 4: Run the tests**

Run: `.venv-digestqa/bin/pytest scripts/digest-qa/tests/test_participation_dims_ballot.py -v`
Expected: `5 passed`

- [ ] **Step 5: Commit**

```bash
git add scripts/digest-qa/participation_dims.py scripts/digest-qa/tests/test_participation_dims_ballot.py
git commit -m "feat(digest-qa): ballot participation dimensions"
```

---

## Task 6: Chat volume and kind dimensions *(Phase 3, parallel with T5 and T7)*

**Files:**
- Modify: `scripts/digest-qa/participation_dims.py` (append; T5 owns the header)
- Create: `scripts/digest-qa/tests/test_participation_dims_chat.py`

**Interfaces:**
- Consumes: `league_context.deduped_messages` and `league_context.identity_resolver` (Task 3).
- Produces: `chat_dims(msgs: list[tuple[str, str, str]], window_start: str, window_end: str) -> dict[str, dict]` — **player name** → `{msgs, chars, days_active, music_links, media, other_links, median_hour, share_off_peak}`.

Note the key type: chat dimensions key on **resolved player name**, not competitor_id. Task 8 joins names to competitor ids. This is deliberate — chat has no competitor id.

Spec §5.2, §5.3. Requires Task 2 (timestamps) for `days_active` to be correct.

- [ ] **Step 1: Write the failing test**

`scripts/digest-qa/tests/test_participation_dims_chat.py`:

```python
from participation_dims import chat_dims

W0, W1 = "2026-01-01T07:00:00Z", "2026-01-08T07:00:00Z"


def M(sender, text, ts):
    return (ts, sender, text)


def test_counts_messages_and_chars_in_window_only():
    msgs = [
        M("Alice", "hello", "2026-01-02T19:00:00Z"),
        M("Alice", "again", "2026-01-03T19:00:00Z"),
        M("Alice", "too early", "2025-12-30T19:00:00Z"),
    ]
    d = chat_dims(msgs, W0, W1)
    assert d["Alice"]["msgs"] == 2
    assert d["Alice"]["chars"] == 10


def test_days_active_counts_distinct_local_days():
    # 2026-01-02T04:00Z is 2026-01-01 21:00 local (UTC-7) -- a DIFFERENT local day
    msgs = [
        M("Bo", "a", "2026-01-02T04:00:00Z"),
        M("Bo", "b", "2026-01-02T19:00:00Z"),
    ]
    assert chat_dims(msgs, W0, W1)["Bo"]["days_active"] == 2


def test_kind_classification_is_mutually_exclusive():
    msgs = [
        M("Cy", "check https://open.spotify.com/track/x", "2026-01-02T19:00:00Z"),
        M("Cy", "\U0001F4F7 Photo", "2026-01-02T19:01:00Z"),
        M("Cy", "see https://example.com", "2026-01-02T19:02:00Z"),
        M("Cy", "just talking", "2026-01-02T19:03:00Z"),
    ]
    d = chat_dims(msgs, W0, W1)
    assert d["Cy"]["music_links"] == 1
    assert d["Cy"]["media"] == 1
    assert d["Cy"]["other_links"] == 1
    assert d["Cy"]["msgs"] == 4


def test_media_wins_over_link_when_both_present():
    msgs = [M("Dee", "\U0001F3A5 Video https://youtu.be/x", "2026-01-02T19:00:00Z")]
    d = chat_dims(msgs, W0, W1)
    assert d["Dee"]["media"] == 1
    assert d["Dee"]["music_links"] == 0


def test_median_hour_is_local():
    msgs = [M("Eve", "x", "2026-01-02T02:00:00Z")]  # 19:00 local
    assert chat_dims(msgs, W0, W1)["Eve"]["median_hour"] == 19
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `.venv-digestqa/bin/pytest scripts/digest-qa/tests/test_participation_dims_chat.py -v`
Expected: FAIL — `ImportError: cannot import name 'chat_dims'`

- [ ] **Step 3: Append the implementation to `participation_dims.py`**

```python
LOCAL_OFFSET_HOURS = 7  # PDT. See spec 4: all data is within PDT.

MEDIA_MARKERS = ("\U0001F4F7", "\U0001F3A5", "\U0001F47E", "\U0001F4CA")  # photo, video, GIF, poll
MUSIC_HOSTS = ("open.spotify.com", "music.youtube.com", "youtu.be", "youtube.com")


def _local_dt(ts: str):
    from datetime import datetime, timedelta
    return datetime.fromisoformat(ts.replace("Z", "")[:19]) - timedelta(hours=LOCAL_OFFSET_HOURS)


def _kind(text: str) -> str:
    """One kind per message. Media wins, then music link, then other link."""
    if any(m in text for m in MEDIA_MARKERS):
        return "media"
    if any(h in text for h in MUSIC_HOSTS):
        return "music_links"
    if "http" in text:
        return "other_links"
    return "text"


def chat_dims(msgs, window_start: str, window_end: str) -> dict[str, dict]:
    """Spec 5.2 and 5.3. msgs is (ts, resolved_sender, text), keyed out by name."""
    out: dict[str, dict] = defaultdict(
        lambda: {"msgs": 0, "chars": 0, "days_active": 0, "music_links": 0,
                 "media": 0, "other_links": 0, "median_hour": 0, "share_off_peak": 0.0})
    days: dict[str, set] = defaultdict(set)
    hours: dict[str, list] = defaultdict(list)

    for ts, sender, text in msgs:
        if not (window_start <= ts < window_end):
            continue
        d = out[sender]
        d["msgs"] += 1
        d["chars"] += len(text)
        k = _kind(text)
        if k != "text":
            d[k] += 1
        local = _local_dt(ts)
        days[sender].add(local.date())
        hours[sender].append(local.hour)

    for sender, d in out.items():
        d["days_active"] = len(days[sender])
        hs = sorted(hours[sender])
        d["median_hour"] = hs[len(hs) // 2] if hs else 0
    return dict(out)
```

- [ ] **Step 4: Run the tests**

Run: `.venv-digestqa/bin/pytest scripts/digest-qa/tests/test_participation_dims_chat.py -v`
Expected: `5 passed`

- [ ] **Step 5: Commit**

```bash
git add scripts/digest-qa/participation_dims.py scripts/digest-qa/tests/test_participation_dims_chat.py
git commit -m "feat(digest-qa): chat volume and kind participation dimensions"
```

---

## Task 7: Conversation dimensions *(Phase 3, parallel with T5 and T6)*

**Files:**
- Create: `scripts/digest-qa/participation_convo.py`
- Create: `scripts/digest-qa/tests/test_participation_convo.py`

**Interfaces:**
- Consumes: nothing beyond stdlib; takes the same `msgs` shape as Task 6.
- Produces:
  - `bursts(msgs, gap_minutes: int = 30) -> list[list[tuple]]`
  - `convo_dims(msgs, window_start, window_end, peak_hours: set[int]) -> dict[str, dict]` — name → `{bursts_joined, group_discussions_joined, elicited, mentions_made, mentions_received, temporal_overlap, share_off_peak}`
  - `peak_hours_for(msgs, coverage: float = 0.75) -> set[int]`

Spec §5.4. Requires Task 2. **Never let a burst span groups** — callers pass one group's messages only.

- [ ] **Step 1: Write the failing test**

`scripts/digest-qa/tests/test_participation_convo.py`:

```python
from participation_convo import bursts, convo_dims, peak_hours_for

W0, W1 = "2026-01-01T00:00:00Z", "2026-01-09T00:00:00Z"


def M(sender, text, ts):
    return (ts, sender, text)


def test_gap_over_thirty_minutes_splits_a_burst():
    msgs = [
        M("A", "x", "2026-01-02T19:00:00Z"),
        M("B", "y", "2026-01-02T19:10:00Z"),
        M("A", "z", "2026-01-02T20:00:00Z"),
    ]
    assert len(bursts(msgs)) == 2


def test_exactly_thirty_minutes_stays_in_one_burst():
    msgs = [
        M("A", "x", "2026-01-02T19:00:00Z"),
        M("B", "y", "2026-01-02T19:30:00Z"),
    ]
    assert len(bursts(msgs)) == 1


def test_single_sender_run_is_not_a_conversation():
    msgs = [M("A", "x", "2026-01-02T19:00:00Z"), M("A", "y", "2026-01-02T19:05:00Z")]
    d = convo_dims(msgs, W0, W1, peak_hours={19})
    assert d["A"]["bursts_joined"] == 0


def test_two_senders_make_a_conversation_three_make_a_discussion():
    two = [M("A", "x", "2026-01-02T19:00:00Z"), M("B", "y", "2026-01-02T19:05:00Z")]
    d = convo_dims(two, W0, W1, peak_hours={19})
    assert d["A"]["bursts_joined"] == 1
    assert d["A"]["group_discussions_joined"] == 0

    three = two + [M("C", "z", "2026-01-02T19:07:00Z")]
    d = convo_dims(three, W0, W1, peak_hours={19})
    assert d["A"]["group_discussions_joined"] == 1


def test_elicited_counts_drawing_in_someone_who_was_quiet():
    msgs = [
        M("A", "anyone about?", "2026-01-02T19:00:00Z"),
        M("B", "here", "2026-01-02T19:05:00Z"),
    ]
    d = convo_dims(msgs, W0, W1, peak_hours={19})
    assert d["A"]["elicited"] == 1


def test_elicited_ignores_someone_already_talking():
    msgs = [
        M("B", "chatting", "2026-01-02T18:50:00Z"),
        M("A", "hi", "2026-01-02T19:00:00Z"),
        M("B", "still here", "2026-01-02T19:05:00Z"),
    ]
    d = convo_dims(msgs, W0, W1, peak_hours={19})
    assert d["A"]["elicited"] == 0


def test_at_mentions_are_counted_both_directions():
    msgs = [M("A", "⁨@⁩Bob nice pick", "2026-01-02T19:00:00Z")]
    d = convo_dims(msgs, W0, W1, peak_hours={19}, roster=["A", "Bob"])
    assert d["A"]["mentions_made"] == 1
    assert d["Bob"]["mentions_received"] == 1


def test_temporal_overlap_is_share_of_messages_in_peak_hours():
    msgs = [
        M("A", "x", "2026-01-02T02:00:00Z"),  # 19:00 local -- peak
        M("A", "y", "2026-01-02T16:00:00Z"),  # 09:00 local -- off peak
    ]
    d = convo_dims(msgs, W0, W1, peak_hours={19})
    assert d["A"]["temporal_overlap"] == 0.5
    assert d["A"]["share_off_peak"] == 0.5


def test_peak_hours_covers_the_requested_share():
    msgs = [M("A", "x", f"2026-01-02T{h:02d}:00:00Z") for h in (2, 2, 2, 3, 16)]
    peaks = peak_hours_for(msgs, coverage=0.75)
    assert 19 in peaks  # 02:00Z == 19:00 local
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `.venv-digestqa/bin/pytest scripts/digest-qa/tests/test_participation_convo.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'participation_convo'`

- [ ] **Step 3: Write the implementation**

`scripts/digest-qa/participation_convo.py`:

```python
#!/usr/bin/env python3
"""Conversation dimensions: bursts, elicited response, temporal overlap.

WhatsApp quote-replies are NOT available to us -- GroupRelay reads Android
notifications, whose payload carries no reply-to. So "conversation" is inferred
from timing and sender interleaving. See spec section 3 and 5.4.

INVARIANT: callers pass one group's messages. A burst must never span groups.
"""
import re
from collections import defaultdict
from datetime import datetime, timedelta

LOCAL_OFFSET_HOURS = 7
ELICIT_WINDOW_MIN = 10   # they answered within this
ELICIT_QUIET_MIN = 30    # ...having been silent for this


def _dt(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "")[:19])


def _local_hour(ts: str) -> int:
    return (_dt(ts) - timedelta(hours=LOCAL_OFFSET_HOURS)).hour


def bursts(msgs, gap_minutes: int = 30) -> list[list[tuple]]:
    """Split a single group's messages into runs separated by group silence."""
    out: list[list[tuple]] = []
    cur: list[tuple] = []
    prev: datetime | None = None
    for m in sorted(msgs):
        t = _dt(m[0])
        if prev is not None and (t - prev) > timedelta(minutes=gap_minutes):
            out.append(cur)
            cur = []
        cur.append(m)
        prev = t
    if cur:
        out.append(cur)
    return out


def peak_hours_for(msgs, coverage: float = 0.75) -> set[int]:
    """Smallest set of local hours holding `coverage` of this league's traffic."""
    counts: dict[int, int] = defaultdict(int)
    for ts, _s, _t in msgs:
        counts[_local_hour(ts)] += 1
    total = sum(counts.values())
    if not total:
        return set()
    peaks: set[int] = set()
    acc = 0
    for h, n in sorted(counts.items(), key=lambda kv: -kv[1]):
        peaks.add(h)
        acc += n
        if acc >= total * coverage:
            break
    return peaks


def _mention_targets(text: str, roster) -> list[str]:
    """@mentions use WhatsApp's FSI/PDI wrappers; fall back to bare names."""
    hits = []
    for name in roster or []:
        first = name.split()[0]
        if re.search(r"@[⁨\s]*" + re.escape(first), text):
            hits.append(name)
        elif re.search(r"(?<![\w])" + re.escape(first) + r"(?![\w])", text):
            hits.append(name)
    return hits


def convo_dims(msgs, window_start: str, window_end: str,
               peak_hours: set[int], roster=None) -> dict[str, dict]:
    """Spec 5.4. msgs is (ts, resolved_sender, text) for ONE group."""
    win = [m for m in sorted(msgs) if window_start <= m[0] < window_end]
    out: dict[str, dict] = defaultdict(
        lambda: {"bursts_joined": 0, "group_discussions_joined": 0, "elicited": 0,
                 "mentions_made": 0, "mentions_received": 0,
                 "temporal_overlap": 0.0, "share_off_peak": 0.0})

    for b in bursts(win):
        senders = {m[1] for m in b}
        if len(senders) < 2:
            continue
        for s in senders:
            out[s]["bursts_joined"] += 1
            if len(senders) >= 3:
                out[s]["group_discussions_joined"] += 1

    for i, (ts, sender, _text) in enumerate(win):
        t = _dt(ts)
        for ts2, sender2, _t2 in win[i + 1:]:
            t2 = _dt(ts2)
            if (t2 - t) > timedelta(minutes=ELICIT_WINDOW_MIN):
                break
            if sender2 == sender:
                continue
            was_quiet = not any(
                s3 == sender2 and timedelta(0) < (t - _dt(ts3)) <= timedelta(minutes=ELICIT_QUIET_MIN)
                for ts3, s3, _ in win[:i]
            )
            if was_quiet:
                out[sender]["elicited"] += 1
                break

    if roster:
        for _ts, sender, text in win:
            for target in _mention_targets(text, roster):
                if target == sender:
                    continue
                out[sender]["mentions_made"] += 1
                out[target]["mentions_received"] += 1

    per_sender: dict[str, list] = defaultdict(list)
    for ts, sender, _t in win:
        per_sender[sender].append(_local_hour(ts))
    for sender, hs in per_sender.items():
        inpeak = sum(1 for h in hs if h in peak_hours)
        out[sender]["temporal_overlap"] = round(inpeak / len(hs), 4)
        out[sender]["share_off_peak"] = round(1 - inpeak / len(hs), 4)

    return dict(out)
```

- [ ] **Step 4: Run the tests**

Run: `.venv-digestqa/bin/pytest scripts/digest-qa/tests/test_participation_convo.py -v`
Expected: `9 passed`

- [ ] **Step 5: Commit**

```bash
git add scripts/digest-qa/participation_convo.py scripts/digest-qa/tests/test_participation_convo.py
git commit -m "feat(digest-qa): burst, elicited and temporal-overlap dimensions"
```

---

## Task 8: Composite scalar and normalisation

**Files:**
- Create: `scripts/digest-qa/participation_score.py`
- Create: `scripts/digest-qa/tests/test_participation_score.py`
- Modify: `scripts/digest-qa/participation.py` (add `compute_round`, wire the CLI)

**Interfaces:**
- Consumes: `VECTOR_FIELDS` (T4), `ballot_dims` (T5), `chat_dims` (T6), `convo_dims`/`peak_hours_for` (T7), `league_context` (T3).
- Produces:
  - `WEIGHTS: dict[str, float]`
  - `composite(vec: dict, maxima: dict) -> float`
  - `percentile_among_active(scores: dict[int, float]) -> dict[int, float]`
  - `participation.compute_round(db, slug: str, round_id: int) -> dict[int, dict]`

Spec §6.

- [ ] **Step 1: Write the failing test**

`scripts/digest-qa/tests/test_participation_score.py`:

```python
import pytest
from participation_score import WEIGHTS, composite, percentile_among_active


def _vec(**kw):
    from participation import VECTOR_FIELDS
    v = {f: 0 for f in VECTOR_FIELDS}
    v["temporal_overlap"] = 1.0
    v.update(kw)
    return v


def test_weights_cover_only_known_fields():
    from participation import VECTOR_FIELDS
    assert set(WEIGHTS) <= set(VECTOR_FIELDS)


def test_kind_counts_carry_no_weight():
    for f in ("music_links", "media", "other_links"):
        assert WEIGHTS.get(f, 0) == 0


def test_composite_scales_each_input_to_the_round_max():
    maxima = {"msgs": 100, "days_active": 7}
    hi = composite(_vec(msgs=100, days_active=7), maxima)
    lo = composite(_vec(msgs=50, days_active=7), maxima)
    assert hi > lo


def test_zero_vector_scores_zero():
    assert composite(_vec(), {"msgs": 10}) == 0


def test_off_peak_poster_is_not_penalised_on_burst_terms():
    maxima = {"bursts_joined": 4}
    on_peak = _vec(bursts_joined=2, temporal_overlap=1.0)
    off_peak = _vec(bursts_joined=1, temporal_overlap=0.5)
    # half the presence, half the opportunity -> same credit
    assert composite(on_peak, maxima) == pytest.approx(composite(off_peak, maxima))


def test_percentile_among_active_ranks_within_the_round():
    p = percentile_among_active({1: 10.0, 2: 20.0, 3: 30.0})
    assert p[3] == 100.0
    assert p[1] == pytest.approx(33.33, abs=0.1)


def test_percentile_handles_a_single_player():
    assert percentile_among_active({1: 5.0}) == {1: 100.0}
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `.venv-digestqa/bin/pytest scripts/digest-qa/tests/test_participation_score.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'participation_score'`

- [ ] **Step 3: Write `participation_score.py`**

```python
#!/usr/bin/env python3
"""Composite score and within-round normalisation.

The scalar is NEVER stored. It is derived here from stored facts plus WEIGHTS,
so tuning a weight retroactively corrects the entire history rather than leaving
the series a mix of old and new opinions. Spec section 2 and 6.
"""

# Deliberately crude starting values (spec 6). Inputs are scaled to their
# within-(league, round) maximum first, so the units are commensurable.
WEIGHTS: dict[str, float] = {
    "voted": 15,
    "vote_comments": 10,
    "vote_comment_chars": 5,
    "sub_comment_chars": 5,
    "days_active": 15,
    "msgs": 8,
    "bursts_joined": 12,
    "group_discussions_joined": 15,
    "elicited": 10,
    "mentions_made": 3,
    # kind counts are character, not weight (spec 5.3)
    "music_links": 0,
    "media": 0,
    "other_links": 0,
}

# Terms whose opportunity depends on other people being present. Divided by
# temporal_overlap so an off-peak poster is not penalised for the league's
# absence (spec 5.4).
OPPORTUNITY_TERMS = {"bursts_joined", "group_discussions_joined", "elicited"}


def composite(vec: dict, maxima: dict) -> float:
    total = 0.0
    overlap = vec.get("temporal_overlap") or 0.0
    for field, weight in WEIGHTS.items():
        if not weight:
            continue
        hi = maxima.get(field) or 0
        if not hi:
            continue
        share = (vec.get(field) or 0) / hi
        if field in OPPORTUNITY_TERMS and overlap > 0:
            share = min(share / overlap, 1.0)
        total += share * weight
    return round(total, 3)


def percentile_among_active(scores: dict[int, float]) -> dict[int, float]:
    """Percentile within this round's active players. Spec 6."""
    if not scores:
        return {}
    ordered = sorted(scores.values())
    n = len(ordered)
    return {
        cid: round(sum(1 for v in ordered if v <= s) / n * 100, 2)
        for cid, s in scores.items()
    }
```

- [ ] **Step 4: Run the tests**

Run: `.venv-digestqa/bin/pytest scripts/digest-qa/tests/test_participation_score.py -v`
Expected: `7 passed`

- [ ] **Step 5: Add `compute_round` to `participation.py`**

Append:

```python
def compute_round(db, slug: str, round_id: int) -> dict[int, dict]:
    """Assemble the full vector for one round of one league.

    Chat dimensions key on player NAME; ballot dimensions key on competitor_id.
    The join happens here, and only here.
    """
    import league_context as lc
    import participation_dims as dims
    import participation_convo as convo

    league_id = lc.league_id_for(db, slug)
    group = lc.chat_group_for(db, slug)
    resolve = lc.identity_resolver(db, league_id)
    raw = lc.deduped_messages(db, group)
    msgs = [(ts, resolve(sender), text) for ts, sender, text in raw]

    season = db.execute("SELECT season_id FROM rounds WHERE id=?", (round_id,)).fetchone()[0]
    window = next(w for w in lc.round_windows(db, season) if w.round_id == round_id)

    peaks = convo.peak_hours_for(msgs)
    names = {n for _t, n, _x in msgs}
    chat = dims.chat_dims(msgs, window.start, window.end)
    conv = convo.convo_dims(msgs, window.start, window.end, peaks, roster=sorted(names))
    ballot = dims.ballot_dims(db, round_id)

    comp_name = {r["id"]: r["name"] for r in db.execute("SELECT id, name FROM competitors")}
    name_comp = {v: k for k, v in comp_name.items()}

    out: dict[int, dict] = {}
    cids = set(ballot) | {name_comp[n] for n in chat if n in name_comp}
    for cid in cids:
        vec = {f: 0 for f in VECTOR_FIELDS}
        vec.update(ballot.get(cid, {}))
        nm = comp_name.get(cid)
        if nm:
            vec.update(chat.get(nm, {}))
            vec.update(conv.get(nm, {}))
        out[cid] = vec
    return out
```

- [ ] **Step 6: Verify against real data**

```bash
.venv-digestqa/bin/python - <<'PY'
import sys, sqlite3; sys.path.insert(0, 'scripts/digest-qa')
import participation as P, participation_score as S
db = sqlite3.connect('data/league.db'); db.row_factory = sqlite3.Row
v = P.compute_round(db, 'second-best', 140)
maxima = {f: max((x.get(f) or 0) for x in v.values()) for f in P.VECTOR_FIELDS}
scores = {c: S.composite(x, maxima) for c, x in v.items()}
names = {r['id']: r['name'] for r in db.execute('SELECT id,name FROM competitors')}
for c, s in sorted(scores.items(), key=lambda kv: -kv[1]):
    x = v[c]
    print(f"{names.get(c,'?'):22} score={s:7.2f}  msgs={x['msgs']:4.0f} days={x['days_active']:2.0f} "
          f"vcom={x['vote_comments']:3.0f} bursts={x['bursts_joined']:3.0f} elic={x['elicited']:3.0f}")
PY
```

Expected sanity checks, all from the spec's observed data: Joe Quinto shows `msgs=0` with `vote_comments=5`; Sarah Zucker shows low `msgs` with non-zero `vote_comments`; Mara shows `days_active=7`; Philip shows `days_active=2`. **If Joe Quinto shows non-zero `msgs`, identity resolution is wrong — stop and report.**

- [ ] **Step 7: Commit**

```bash
git add scripts/digest-qa/participation_score.py scripts/digest-qa/tests/test_participation_score.py scripts/digest-qa/participation.py
git commit -m "feat(digest-qa): composite score, opportunity adjustment, percentile-among-active"
```

---

## Task 9: Review report *(Phase 5, parallel with T10)*

**Files:**
- Create: `scripts/digest-qa/participation_report.py`
- Create: `scripts/digest-qa/tests/test_participation_report.py`
- Modify: `scripts/digest-qa/participation.py` (add `--report`)

**Interfaces:**
- Consumes: `load_vectors` (T4), `composite`/`percentile_among_active` (T8).
- Produces: `render_report(league: str, round_name: str, rows: list[dict], trend: list[tuple]) -> str` returning self-contained HTML.

Spec §9. Follow the structure of `scripts/digest-qa/dupe_review_page.py` — self-contained, inline CSS, no external assets, dark theme.

- [ ] **Step 1: Write the failing test**

`scripts/digest-qa/tests/test_participation_report.py`:

```python
from participation_report import render_report

ROWS = [
    {"name": "Joe Quinto", "score": 30.0, "pct": 20.0, "delta": -5.0,
     "vec": {"msgs": 0, "days_active": 0, "vote_comments": 5}},
    {"name": "Mara", "score": 80.0, "pct": 100.0, "delta": 3.0,
     "vec": {"msgs": 25, "days_active": 7, "vote_comments": 5}},
]


def test_report_is_self_contained():
    html = render_report("second-best", "More Cowbell!", ROWS, [(139, 50.0), (140, 55.0)])
    assert "<style>" in html
    assert "http://" not in html and "https://" not in html


def test_every_player_appears():
    html = render_report("second-best", "More Cowbell!", ROWS, [])
    assert "Joe Quinto" in html and "Mara" in html


def test_impact_block_is_present_but_empty():
    html = render_report("second-best", "More Cowbell!", ROWS, [])
    assert "Impact" in html
    assert "project D" in html


def test_falling_players_are_flagged():
    html = render_report("second-best", "More Cowbell!", ROWS, [])
    assert "falling" in html.lower()
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `.venv-digestqa/bin/pytest scripts/digest-qa/tests/test_participation_report.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'participation_report'`

- [ ] **Step 3: Write `participation_report.py`**

```python
#!/usr/bin/env python3
"""Per-round participation review page. Spec section 9.

Self-contained HTML, same shape as dupe_review_page.py: no external assets, so
it opens correctly from a phone via an ntfy tap.
"""
import html

CSS = """
body{margin:0;background:#14161a;color:#e8e6e3;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:1000px;margin:0 auto;padding:24px 18px 80px}
h1{font-size:23px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 10px;border-top:1px solid #2c3138;padding-top:16px}
.sub{color:#9aa0a6;margin:0 0 20px}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{border:1px solid #2c3138;padding:6px 9px;text-align:left}
th{background:#1d2129;color:#9aa0a6;font-size:12px;text-transform:uppercase;letter-spacing:.06em}
td.n{text-align:right;font-variant-numeric:tabular-nums}
.down{color:#ff6b6b;font-weight:700}.up{color:#5ec98a}
.note{color:#9aa0a6;font-size:13px}
.empty{border:1px dashed #2c3138;border-radius:8px;padding:14px;color:#9aa0a6}
"""


def render_report(league: str, round_name: str, rows, trend) -> str:
    p = ['<!doctype html><meta charset="utf-8">',
         f"<title>participation · {html.escape(league)}</title>",
         f"<style>{CSS}</style><div class='wrap'>",
         f"<h1>Participation — {html.escape(league)}</h1>",
         f"<p class='sub'>{html.escape(round_name)} · internal. No number here ships to the league.</p>"]

    p.append("<h2>This round</h2><table><tr><th>player</th><th>score</th><th>pct</th>"
             "<th>vs last</th><th>msgs</th><th>days</th><th>vote comments</th></tr>")
    for r in rows:
        d = r.get("delta") or 0
        cls = "down" if d < 0 else "up"
        v = r["vec"]
        p.append(
            f"<tr><td>{html.escape(r['name'])}</td>"
            f"<td class='n'>{r['score']:.1f}</td><td class='n'>{r['pct']:.0f}</td>"
            f"<td class='n {cls}'>{d:+.1f}</td>"
            f"<td class='n'>{v.get('msgs',0):.0f}</td><td class='n'>{v.get('days_active',0):.0f}</td>"
            f"<td class='n'>{v.get('vote_comments',0):.0f}</td></tr>")
    p.append("</table>")

    falling = [r for r in rows if (r.get("delta") or 0) < 0]
    p.append("<h2>Targeting</h2>")
    if falling:
        p.append("<p class='note'>Players falling since last round — candidates to feature:</p><ul>")
        for r in sorted(falling, key=lambda r: r["delta"]):
            v = r["vec"]
            shape = ("talks, never comments" if v.get("msgs") and not v.get("vote_comments")
                     else "comments, never talks" if v.get("vote_comments") and not v.get("msgs")
                     else "present in both channels")
            p.append(f"<li><b>{html.escape(r['name'])}</b> ({r['delta']:+.1f}) — {shape}</li>")
        p.append("</ul>")
    else:
        p.append("<p class='note'>Nobody is falling this round.</p>")

    if trend:
        p.append("<h2>League trend</h2><table><tr><th>round</th><th>mean score</th></tr>")
        for rid, mean in trend:
            p.append(f"<tr><td>{rid}</td><td class='n'>{mean:.1f}</td></tr>")
        p.append("</table>")

    p.append("<h2>Impact</h2><div class='empty'>Reserved for <b>project D</b>: for players "
             "featured in this round's digest, what their participation did next round. "
             "Columns defined, deliberately empty — the join accumulates from now so it is "
             "reconstructable when D starts.</div>")
    p.append("</div>")
    return "\n".join(p)
```

- [ ] **Step 4: Run the tests**

Run: `.venv-digestqa/bin/pytest scripts/digest-qa/tests/test_participation_report.py -v`
Expected: `4 passed`

- [ ] **Step 5: Wire `--report` into the CLI and generate one**

```bash
.venv-digestqa/bin/python scripts/digest-qa/participation.py second-best --round 140 --report
```

Expected: writes `out/participation-second-best-140.html`. Open it and confirm Joe Quinto appears with `msgs=0`.

- [ ] **Step 6: Commit**

```bash
git add scripts/digest-qa/participation_report.py scripts/digest-qa/tests/test_participation_report.py scripts/digest-qa/participation.py
git commit -m "feat(digest-qa): participation review page with reserved impact block"
```

---

## Task 10: Backfill and reconciliation *(Phase 5, parallel with T9)*

**Files:**
- Modify: `scripts/digest-qa/participation.py` (add `backfill`, CLI entry)
- Create: `scripts/digest-qa/tests/test_participation_backfill.py`

**Interfaces:**
- Consumes: `compute_round` (T8), `store_vector` (T4), `round_windows` (T3).
- Produces: `backfill(db, slug: str) -> int` returning rows written.

Spec §7.

- [ ] **Step 1: Write the failing test**

`scripts/digest-qa/tests/test_participation_backfill.py`:

```python
from conftest import add_msg, add_round, add_vote
import participation as P


def _seed(db):
    db.execute("INSERT INTO competitors VALUES (1,'Alice')")
    db.execute("INSERT INTO players VALUES (1,'Alice')")
    db.execute("INSERT INTO player_identities (id,player_id,league_id,identity_type,identifier)"
               " VALUES (1,1,1,'whatsapp','Alice')")
    add_round(db, 1, "2026-01-08T07:00:00Z")
    add_round(db, 2, "2026-01-15T07:00:00Z")
    add_msg(db, "Alice", "hello", "2026-01-10T19:00:00Z")
    add_vote(db, 2, 1, "uri:a", 3, "nice")


def test_backfill_writes_a_row_per_round_with_activity(fixture_db):
    _seed(fixture_db)
    P.ensure_schema(fixture_db)
    n = P.backfill(fixture_db, "test-league")
    assert n >= 1
    assert P.load_vectors(fixture_db, 1, 2)[1]["vote_comments"] == 1


def test_backfill_is_idempotent(fixture_db):
    _seed(fixture_db)
    P.ensure_schema(fixture_db)
    first = P.backfill(fixture_db, "test-league")
    second = P.backfill(fixture_db, "test-league")
    assert first == second
    rows = fixture_db.execute("SELECT COUNT(*) FROM player_participation").fetchone()[0]
    assert rows == first
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `.venv-digestqa/bin/pytest scripts/digest-qa/tests/test_participation_backfill.py -v`
Expected: FAIL — `AttributeError: module 'participation' has no attribute 'backfill'`

- [ ] **Step 3: Add `backfill` and the CLI to `participation.py`**

```python
def backfill(db, slug: str) -> int:
    """Compute and store every completed round for one league. Idempotent."""
    import league_context as lc
    league_id = lc.league_id_for(db, slug)
    season_ids = [r[0] for r in db.execute(
        "SELECT id FROM seasons WHERE league_id=? ORDER BY id", (league_id,))]
    written = 0
    for sid in season_ids:
        for w in lc.round_windows(db, sid):
            for cid, vec in compute_round(db, slug, w.round_id).items():
                store_vector(db, league_id, w.round_id, cid, vec)
                written += 1
    db.commit()
    return written


def main() -> None:
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("league_slug")
    ap.add_argument("--db", default="data/league.db")
    ap.add_argument("--round", type=int)
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    db = sqlite3.connect(args.db)
    db.row_factory = sqlite3.Row
    ensure_schema(db)

    import league_context as lc
    import participation_score as score
    league_id = lc.league_id_for(db, args.league_slug)

    if args.round:
        vecs = compute_round(db, args.league_slug, args.round)
        for cid, vec in vecs.items():
            store_vector(db, league_id, args.round, cid, vec)
        db.commit()
    else:
        n = backfill(db, args.league_slug)
        print(f"stored {n} player-round vectors")
        return

    if args.json:
        import json as _json
        print(_json.dumps(vecs, indent=2))
        return

    if args.report:
        import os
        import participation_report as rep
        names = {r["id"]: r["name"] for r in db.execute("SELECT id, name FROM competitors")}
        maxima = {f: max((v.get(f) or 0) for v in vecs.values()) or 0 for f in VECTOR_FIELDS}
        scores = {c: score.composite(v, maxima) for c, v in vecs.items()}
        pct = score.percentile_among_active(scores)
        prev = db.execute(
            "SELECT MAX(round_id) FROM player_participation WHERE league_id=? AND round_id<?",
            (league_id, args.round)).fetchone()[0]
        prev_scores = {}
        if prev:
            pv = load_vectors(db, league_id, prev)
            pmax = {f: max((v.get(f) or 0) for v in pv.values()) or 0 for f in VECTOR_FIELDS}
            prev_scores = {c: score.composite(v, pmax) for c, v in pv.items()}
        rows = [{"name": names.get(c, "?"), "score": s, "pct": pct[c],
                 "delta": s - prev_scores.get(c, s), "vec": vecs[c]}
                for c, s in sorted(scores.items(), key=lambda kv: -kv[1])]
        rname = db.execute("SELECT name FROM rounds WHERE id=?", (args.round,)).fetchone()["name"]
        os.makedirs("out", exist_ok=True)
        path = f"out/participation-{args.league_slug}-{args.round}.html"
        with open(path, "w") as fh:
            fh.write(rep.render_report(args.league_slug, rname, rows, []))
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the tests**

Run: `.venv-digestqa/bin/pytest scripts/digest-qa/tests/test_participation_backfill.py -v`
Expected: `2 passed`

- [ ] **Step 5: Back up, then backfill both leagues for real**

```bash
cp data/league.db data/league.db.bak-partbackfill-$(date +%s)
.venv-digestqa/bin/python scripts/digest-qa/participation.py second-best
.venv-digestqa/bin/python scripts/digest-qa/participation.py boarz-ii-men
```

- [ ] **Step 6: Reconcile against `chat_participation.py`**

```bash
.venv-digestqa/bin/python - <<'PY'
import sys, sqlite3; sys.path.insert(0, 'scripts/digest-qa')
import participation as P
db = sqlite3.connect('data/league.db'); db.row_factory = sqlite3.Row
tot = db.execute("""SELECT round_id, SUM(msgs) m FROM player_participation
                    WHERE league_id=(SELECT id FROM leagues WHERE slug='second-best')
                    GROUP BY round_id ORDER BY round_id""").fetchall()
for r in tot:
    print(f"round {r['round_id']}: {r['m']:.0f} chat msgs")
print("\nCompare against: .venv-digestqa/bin/python scripts/digest-qa/chat_participation.py second-best")
PY
```

Expected: the per-round message totals match `chat_participation.py`'s `msgs` column exactly. **They must match by construction** — both read `league_context.deduped_messages`. Any difference is a bug in the window join, not a rounding artifact.

- [ ] **Step 7: Run the whole suite and commit**

```bash
.venv-digestqa/bin/pytest
git add scripts/digest-qa/participation.py scripts/digest-qa/tests/test_participation_backfill.py
git commit -m "feat(digest-qa): participation backfill across both leagues"
```

---

## Self-Review

**Spec coverage:**

| spec section | task |
|---|---|
| §1 purpose, visibility, non-goals | Global Constraints; T9 report header states "internal" |
| §2 vector stored / scalar derived | T4 (no score column), T8 (`composite` computed on read) |
| §3 scoping invariant | T3 (`identity_resolver` per league), T4 (PK includes league_id), T7 (burst invariant), T10 tests |
| §4 task zero timestamps | T2 |
| §5.1 ballot dims | T5 |
| §5.2 chat volume | T6 |
| §5.3 chat kind | T6 |
| §5.4 conversation | T7 |
| §5.5 context (`rounds_in_league`) | **GAP — see below** |
| §6 scalar, level + position | T8 |
| §7 backfill scope | T10 |
| §9 review surface | T9 |
| §10 testing | T2 steps 7–8, T3 step 6, T10 step 6 |

**Gap found and closed:** `rounds_in_league` is in `VECTOR_FIELDS` but no task populates it. Add to Task 8, Step 5, inside `compute_round` before `out[cid] = vec`:

```python
        vec["rounds_in_league"] = db.execute(
            "SELECT COUNT(*) FROM rounds r JOIN seasons s ON s.id=r.season_id"
            " WHERE s.league_id=? AND r.voting_deadline IS NOT NULL"
            " AND r.voting_deadline <= (SELECT voting_deadline FROM rounds WHERE id=?)",
            (league_id, round_id)).fetchone()[0]
```

**Placeholder scan:** clean — every code step contains runnable code; no "add error handling" or "similar to Task N".

**Type consistency:** `VECTOR_FIELDS` (T4) is the single contract; T5/T6/T7 return subsets of it and T8 merges them. Chat dims key on player **name**, ballot dims on **competitor_id** — the join is documented in the T6 interface block and performed once, in `compute_round`. `RoundWindow` fields (`round_id`, `name`, `start`, `end`) are used consistently in T8 and T10.
