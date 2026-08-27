import json

import host_executor as hx


def test_claimable_returns_pending_host_cuts_in_current_ep(db, run):
    ids = [c["cut_id"] for c in hx.claimable_cuts(db, run, 0)]
    assert ids == ["a", "b"]


def test_claimable_excludes_other_eps(db, run):
    assert [c["cut_id"] for c in hx.claimable_cuts(db, run, 1)] == ["agent"]


def test_claim_succeeds_once(db, run):
    assert hx.claim(db, run, "a", "t1") is True
    assert hx.claim(db, run, "a", "t1") is False


def test_claim_sets_running_and_lease(db, run):
    hx.claim(db, run, "a", "t1")
    row = db.execute(
        "SELECT state, claimed_at, heartbeat_at FROM rollout_cut_runs"
        " WHERE run_id=? AND cut_id='a'", (run,)).fetchone()
    assert row["state"] == "running"
    assert row["claimed_at"] == "t1"
    assert row["heartbeat_at"] == "t1"


def test_build_context_includes_only_earlier_eps(db, run):
    db.execute("UPDATE rollout_cut_runs SET state='done', output_json='{\"x\":1}'"
               " WHERE run_id=? AND cut_id='a'", (run,))
    db.execute("UPDATE rollout_cut_runs SET state='done', output_json='{\"y\":2}'"
               " WHERE run_id=? AND cut_id='b'", (run,))
    db.commit()
    ctx = hx.build_context(db, run, "agent")
    assert [u["cut_id"] for u in ctx["upstream"]] == ["a", "b"]


def test_build_context_excludes_same_ep_siblings(db, run):
    db.execute("UPDATE rollout_cut_runs SET state='done', output_json='{\"x\":1}'"
               " WHERE run_id=? AND cut_id='a'", (run,))
    db.commit()
    assert hx.build_context(db, run, "b")["upstream"] == []


def test_run_script_cut_substitutes_placeholders():
    cut = {"kind": "script", "command": ["echo", "{roundId}"]}
    res = hx.run_script_cut(cut, {"roundId": "9", "leagueSlug": "sb"}, cwd=".")
    assert res["exit_code"] == 0
    assert "9" in (res["output_json"] or res["stdout"])


def test_run_script_cut_reports_nonzero_exit():
    res = hx.run_script_cut({"kind": "script", "command": ["false"]}, {}, cwd=".")
    assert res["exit_code"] != 0


def test_run_script_cut_captures_json_stdout():
    payload = json.dumps({"checks": [{"severity": "warn"}]})
    cut = {"kind": "script", "command": ["python3", "-c", f"print({payload!r})"]}
    res = hx.run_script_cut(cut, {}, cwd=".")
    assert json.loads(res["output_json"])["checks"][0]["severity"] == "warn"


def test_run_script_cut_treats_a_missing_binary_as_transient(db):
    res = hx.run_script_cut({"kind": "script", "command": ["definitely-not-a-binary"]}, {}, cwd=".")
    assert res["error"]  # transient -> spends an attempt, not a remaster


def test_tick_runs_a_claimable_cut_and_records_output(db, run, monkeypatch):
    monkeypatch.setattr(hx, "run_script_cut",
                        lambda cut, subs, cwd, hb=None: {"exit_code": 0, "output_json": '{"ok":1}', "error": None})
    assert hx.tick(db, repo=".", now_fn=lambda: "t1") == 2  # both EP0 cuts
    row = db.execute("SELECT state, output_json FROM rollout_cut_runs"
                     " WHERE run_id=? AND cut_id='a'", (run,)).fetchone()
    assert row["state"] == "done"
    assert row["output_json"] == '{"ok":1}'


def test_tick_ignores_a_parked_run(db, run, monkeypatch):
    db.execute("UPDATE rollout_runs SET state='parked' WHERE id=?", (run,))
    db.commit()
    monkeypatch.setattr(hx, "run_script_cut", lambda *a, **k: {"exit_code": 0, "output_json": None, "error": None})
    assert hx.tick(db, repo=".", now_fn=lambda: "t1") == 0


def test_tick_does_not_advance_the_ep(db, run, monkeypatch):
    """EP advance is the app executor's job; the host only completes cuts."""
    monkeypatch.setattr(hx, "run_script_cut", lambda *a, **k: {"exit_code": 0, "output_json": None, "error": None})
    hx.tick(db, repo=".", now_fn=lambda: "t1")
    assert db.execute("SELECT current_ep FROM rollout_runs WHERE id=?", (run,)).fetchone()["current_ep"] == 0


def test_tick_marks_finished_cuts_awaiting_classification(db, run, monkeypatch):
    """C2: the host has no notion of checks/retries/remasters — a finished cut
    must be flagged so the app executor's engine reclassifies it."""
    monkeypatch.setattr(hx, "run_script_cut",
                        lambda cut, subs, cwd, hb=None: {"exit_code": 0, "output_json": '{"ok":1}', "error": None})
    hx.tick(db, repo=".", now_fn=lambda: "t1")
    row = db.execute("SELECT awaiting_classification FROM rollout_cut_runs"
                     " WHERE run_id=? AND cut_id='a'", (run,)).fetchone()
    assert row["awaiting_classification"] == 1


# ------------------------------------------------------- heartbeats (I5)

def test_run_with_heartbeat_fires_while_the_process_runs(monkeypatch):
    monkeypatch.setattr(hx, "HEARTBEAT_SECONDS", 0.05)
    beats = []
    proc = hx._run_with_heartbeat(["sleep", "0.4"], timeout=5, hb=lambda: beats.append(1))
    assert proc.returncode == 0
    assert len(beats) >= 2  # a 900s claude cut would beat well inside the 600s lease


def test_run_with_heartbeat_pipes_stdin_and_captures_stdout():
    proc = hx._run_with_heartbeat(["cat"], timeout=5, hb=lambda: None, input_text="hello dossier")
    assert proc.returncode == 0
    assert proc.stdout == "hello dossier"


def test_run_with_heartbeat_kills_on_timeout():
    import subprocess
    import pytest
    with pytest.raises(subprocess.TimeoutExpired):
        hx._run_with_heartbeat(["sleep", "5"], timeout=0.3, hb=lambda: None)


def test_run_script_cut_heartbeats(monkeypatch):
    monkeypatch.setattr(hx, "HEARTBEAT_SECONDS", 0.05)
    beats = []
    res = hx.run_script_cut({"kind": "script", "command": ["sleep", "0.3"]}, {}, cwd=".",
                            hb=lambda: beats.append(1))
    assert res["exit_code"] == 0
    assert beats


def test_finish_does_not_clobber_a_reaped_row(db, run):
    """If reapStaleCuts already returned the cut to pending (executor presumed
    dead), a late _finish from the old executor must not overwrite the row."""
    hx.claim(db, run, "a", "t1")
    db.execute("UPDATE rollout_cut_runs SET state='pending', attempts=attempts+1,"
               " claimed_at=NULL, heartbeat_at=NULL WHERE run_id=? AND cut_id='a'", (run,))
    db.commit()
    hx._finish(db, run, "a", {"exit_code": 0, "output_json": '{"late":1}'}, "t2")
    row = db.execute("SELECT state, output_json, awaiting_classification FROM rollout_cut_runs"
                     " WHERE run_id=? AND cut_id='a'", (run,)).fetchone()
    assert row["state"] == "pending"
    assert row["output_json"] is None
    assert row["awaiting_classification"] == 0
