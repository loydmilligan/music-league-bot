import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, statSync, utimesSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openInteractionLog, RETENTION_DAYS } from '../src/storage/interactionLog.js';

let root: string;
let dir: string;
let clock: number;
const now = () => new Date(clock);
const lines = (f: string) => readFileSync(join(dir, f), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const START = { group: 'g1@g.us', who: 'p1', authorKind: 'lid' as const, command: 'catch me up' };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ilog-'));
  dir = join(root, 'interactions');
  clock = Date.parse('2026-11-06T20:00:00Z'); // 12:00 LA
});
afterEach(() => {
  try { chmodSync(root, 0o755); } catch { /* */ }
  rmSync(root, { recursive: true, force: true });
});

describe('interactionLog', () => {
  it('writes start/step/end lines with shared id and clock-derived timings', () => {
    const log = openInteractionLog({ dir, now });
    const tr = log.begin('cmu');
    expect(tr.id).toMatch(/^[0-9a-f]{12}$/);
    tr.start(START);
    clock += 150;
    tr.step('fetch', { ok: true, ms: 120 });
    clock += 850;
    tr.end('ok');
    const rows = lines('2026-11-06.jsonl');
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r).toMatchObject({ v: 1, id: tr.id, kind: 'cmu' });
    expect(rows.map((r) => r.ev)).toEqual(['start', 'step', 'end']);
    expect(rows[1]).toMatchObject({ step: 'fetch', ok: true, ms: 120, t: 150 });
    expect(rows[2]).toMatchObject({ outcome: 'ok', totalMs: 1000 });
    expect(rows[0].at).toBe('2026-11-06T20:00:00.000Z');
  });

  it('keeps a request spanning LA midnight in its start day file', () => {
    clock = Date.parse('2026-11-07T07:59:59Z'); // 23:59:59 LA on the 6th
    const tr = openInteractionLog({ dir, now }).begin('cmu');
    tr.start(START);
    clock += 5000;
    tr.end('ok');
    expect(readdirSync(dir).filter((f) => f.endsWith('.jsonl'))).toEqual(['2026-11-06.jsonl']);
    expect(lines('2026-11-06.jsonl')).toHaveLength(2);
  });

  it('truncates long values and never exceeds 8 KB per line', () => {
    const tr = openInteractionLog({ dir, now }).begin('cmu');
    tr.start({ ...START, command: 'x'.repeat(2000) });
    tr.step('big', { ok: true, a: 'y'.repeat(600), list: Array.from({ length: 100 }, () => 'z'.repeat(500)) });
    const rows = lines('2026-11-06.jsonl');
    expect(rows[0].command).toHaveLength(512);
    expect(rows[1].a).toHaveLength(512);
    for (const l of readFileSync(join(dir, '2026-11-06.jsonl'), 'utf8').trim().split('\n')) {
      expect(Buffer.byteLength(l) + 1).toBeLessThanOrEqual(8192);
    }
    // many large fields still fit
    const f: Record<string, string> = {};
    for (let i = 0; i < 40; i++) f['k' + i] = 'q'.repeat(500);
    tr.step('many', { ok: true, ...f });
    const last = readFileSync(join(dir, '2026-11-06.jsonl'), 'utf8').trim().split('\n').pop()!;
    expect(Buffer.byteLength(last) + 1).toBeLessThanOrEqual(8192);
    expect(JSON.parse(last)).toMatchObject({ step: 'many', ok: true, id: tr.id });
  });

  it('does not throw on an unwritable dir and logs at most once per minute', () => {
    if (process.getuid?.() === 0) return;
    mkdirSync(root, { recursive: true });
    chmodSync(root, 0o555);
    const msgs: string[] = [];
    const tr = openInteractionLog({ dir, now, log: (l) => msgs.push(l) }).begin('cmu');
    expect(() => { tr.start(START); tr.step('a', { ok: true }); tr.end('ok'); tr.thumbPath(); }).not.toThrow();
    expect(msgs.length).toBeLessThanOrEqual(1);
    expect(msgs.length).toBe(1);
  });

  it('prunes day files and images older than retention, ignoring other files', () => {
    const log = openInteractionLog({ dir, now });
    mkdirSync(join(dir, 'img'), { recursive: true });
    const dayMs = 86_400_000;
    const ago = (n: number) => new Date(clock - n * dayMs);
    const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d);
    const old = join(dir, `${ymd(ago(RETENTION_DAYS + 1))}.jsonl`);
    const keep = join(dir, `${ymd(ago(RETENTION_DAYS))}.jsonl`);
    const oldImg = join(dir, 'img', 'aaaaaaaaaaaa.jpg');
    const keepImg = join(dir, 'img', 'bbbbbbbbbbbb.jpg');
    const other = join(dir, 'notes.txt');
    const otherImg = join(dir, 'img', 'readme.txt');
    for (const p of [old, keep, oldImg, keepImg, other, otherImg]) writeFileSync(p, 'x');
    utimesSync(oldImg, ago(RETENTION_DAYS + 1), ago(RETENTION_DAYS + 1));
    utimesSync(keepImg, ago(RETENTION_DAYS), ago(RETENTION_DAYS));
    utimesSync(otherImg, ago(100), ago(100));
    expect(log.prune()).toEqual({ files: 1, images: 1 });
    expect(existsSync(old)).toBe(false);
    expect(existsSync(oldImg)).toBe(false);
    for (const p of [keep, keepImg, other, otherImg]) expect(existsSync(p)).toBe(true);
  });

  it('prunes automatically on the first begin of a new LA day', () => {
    const log = openInteractionLog({ dir, now });
    mkdirSync(dir, { recursive: true });
    const stale = join(dir, '2020-01-01.jsonl');
    writeFileSync(stale, 'x');
    log.begin('cmu');
    expect(existsSync(stale)).toBe(false);
  });

  it('creates dir 0755 and files 0644', () => {
    const tr = openInteractionLog({ dir, now }).begin('cmu');
    tr.start(START);
    const thumb = tr.thumbPath();
    expect(thumb).toBe(join(dir, 'img', `${tr.id}.jpg`));
    expect(statSync(dir).mode & 0o777).toBe(0o755);
    expect(statSync(join(dir, 'img')).mode & 0o777).toBe(0o755);
    expect(statSync(join(dir, '2026-11-06.jsonl')).mode & 0o777).toBe(0o644);
  });

  it('keeps day files 0644 even under a restrictive umask', () => {
    const old = process.umask(0o077);
    try {
      const tr = openInteractionLog({ dir, now }).begin('cmu');
      tr.start(START);
      tr.end('card');
      expect(statSync(join(dir, '2026-11-06.jsonl')).mode & 0o777).toBe(0o644);
    } finally {
      process.umask(old);
    }
  });
});
