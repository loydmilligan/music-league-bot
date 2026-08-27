import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '$lib/db/schema.js';

function db() {
  const d = new Database(':memory:');
  d.exec(SCHEMA);
  return d;
}

describe('rollout schema', () => {
  it('creates the three rollout tables', () => {
    const names = db().prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'rollout_%' ORDER BY name",
    ).all() as { name: string }[];
    expect(names.map((r) => r.name)).toEqual(['rollout_cut_runs', 'rollout_configs', 'rollout_runs'].sort());
  });

  it('defaults a config to disabled — degenerate safety', () => {
    const d = db();
    d.prepare('INSERT INTO leagues (id, slug, name) VALUES (1, ?, ?)').run('x', 'X');
    d.prepare('INSERT INTO rollout_configs (league_id, definition_json, updated_at) VALUES (1, ?, ?)')
      .run('{}', '2026-08-26T00:00:00Z');
    const row = d.prepare('SELECT enabled FROM rollout_configs WHERE league_id=1').get() as { enabled: number };
    expect(row.enabled).toBe(0);
  });

  it('cascades cut runs when a run is deleted', () => {
    const d = db();
    d.pragma('foreign_keys = ON');
    d.prepare('INSERT INTO leagues (id, slug, name) VALUES (1, ?, ?)').run('x', 'X');
    d.prepare("INSERT INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 1, 'active')").run();
    d.prepare('INSERT INTO rounds (id, season_id, ml_round_id, name, created_at) VALUES (9, 1, ?, ?, ?)').run('ml-9', 'R', 't');
    d.prepare(`INSERT INTO rollout_runs (id, league_id, round_id, definition_json, state, current_ep, started_at, updated_at)
               VALUES ('r1', 1, 9, '{}', 'running', 0, ?, ?)`).run('t', 't');
    d.prepare(`INSERT INTO rollout_cut_runs (run_id, cut_id, ep, runtime, state)
               VALUES ('r1', 'capture', 0, 'app', 'pending')`).run();
    d.prepare("DELETE FROM rollout_runs WHERE id='r1'").run();
    const n = d.prepare('SELECT COUNT(*) AS n FROM rollout_cut_runs').get() as { n: number };
    expect(n.n).toBe(0);
  });

  it('permits at most one run per round', () => {
    const d = db();
    d.prepare('INSERT INTO leagues (id, slug, name) VALUES (1, ?, ?)').run('x', 'X');
    d.prepare("INSERT INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 1, 'active')").run();
    d.prepare('INSERT INTO rounds (id, season_id, ml_round_id, name, created_at) VALUES (9, 1, ?, ?, ?)').run('ml-9', 'R', 't');
    const ins = (id: string) => d.prepare(
      `INSERT INTO rollout_runs (id, league_id, round_id, definition_json, state, current_ep, started_at, updated_at)
       VALUES (?, 1, 9, '{}', 'running', 0, 't', 't')`).run(id);
    ins('r1');
    expect(() => ins('r2')).toThrow();
  });
});
