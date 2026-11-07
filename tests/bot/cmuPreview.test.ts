import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openCmuPreview, memoryCmuPreview, cmuPreviewPath } from '../../src/bot/cmuPreview.js';

const A = '120363000000000001@g.us';
const B = '120363000000000002@g.us';
const P = '100000000000001@lid';
const Q = '100000000000002@lid';

const dirs: string[] = [];
function tmpFile(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cmu-preview-'));
  dirs.push(dir);
  return path.join(dir, 'cmu-preview.json');
}
function write(file: string, body: string, mtimeSec: number): void {
  writeFileSync(file, body);
  utimesSync(file, mtimeSec, mtimeSec);
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('cmuPreview', () => {
  it('matches listed group ids exactly, with no substring match', () => {
    const file = tmpFile();
    write(file, JSON.stringify({ groups: [A] }), 1000);
    const p = openCmuPreview(file);
    expect(p.isPreview(A)).toBe(true);
    expect(p.isPreview(B)).toBe(false);
    expect(p.isPreview('x' + A)).toBe(false);
    expect(p.isPreview(A + 'x')).toBe(false);
    expect(p.isPreview('')).toBe(false);
  });

  it('matches people exactly and keeps groups and people separate', () => {
    const file = tmpFile();
    write(file, JSON.stringify({ groups: [A], people: [P] }), 1000);
    const p = openCmuPreview(file);
    expect(p.isPreviewPerson(P)).toBe(true);
    expect(p.isPreviewPerson(Q)).toBe(false);
    expect(p.isPreviewPerson('x' + P)).toBe(false);
    expect(p.isPreviewPerson(A)).toBe(false);
    expect(p.isPreview(P)).toBe(false);
  });

  it('a file with only groups has no people, and only people has no groups', () => {
    const f1 = tmpFile();
    write(f1, JSON.stringify({ groups: [A] }), 1000);
    expect(openCmuPreview(f1).isPreviewPerson(P)).toBe(false);
    expect(openCmuPreview(f1).isPreview(A)).toBe(true);
    const f2 = tmpFile();
    write(f2, JSON.stringify({ people: [P] }), 1000);
    expect(openCmuPreview(f2).isPreview(A)).toBe(false);
    expect(openCmuPreview(f2).isPreviewPerson(P)).toBe(true);
  });

  it('a non-array people is ignored', () => {
    const file = tmpFile();
    write(file, JSON.stringify({ groups: [A], people: P }), 1000);
    const p = openCmuPreview(file);
    expect(p.isPreviewPerson(P)).toBe(false);
    expect(p.isPreview(A)).toBe(true);
  });

  it('a missing file is false for every id', () => {
    const p = openCmuPreview(tmpFile());
    expect(p.isPreview(A)).toBe(false);
  });

  it.each(['not json', '', 'null', '[]', '{}', `{"groups":"${A}"}`])('a corrupt/misshapen file (%j) is false', (body) => {
    const file = tmpFile();
    write(file, body, 1000);
    expect(openCmuPreview(file).isPreview(A)).toBe(false);
  });

  it('ignores non-string entries but keeps string ones', () => {
    const file = tmpFile();
    write(file, JSON.stringify({ groups: [1, null, { a: 1 }, A] }), 1000);
    const p = openCmuPreview(file);
    expect(p.isPreview(A)).toBe(true);
    expect(p.isPreview('1')).toBe(false);
  });

  it('sees a rewritten list with a newer mtime without reopening', () => {
    const file = tmpFile();
    write(file, JSON.stringify({ groups: [A] }), 1000);
    const p = openCmuPreview(file);
    expect(p.isPreview(A)).toBe(true);
    expect(p.isPreview(B)).toBe(false);
    write(file, JSON.stringify({ groups: [B], people: [P] }), 2000);
    expect(p.isPreview(A)).toBe(false);
    expect(p.isPreview(B)).toBe(true);
    expect(p.isPreviewPerson(P)).toBe(true);
  });

  it('does not re-read while the mtime is unchanged', () => {
    const file = tmpFile();
    write(file, JSON.stringify({ groups: [A] }), 1000);
    let reads = 0;
    const readFn = ((...args: Parameters<typeof readFileSync>) => {
      reads++;
      return readFileSync(...args);
    }) as typeof readFileSync;
    const p = openCmuPreview(file, { readFn });
    p.isPreview(A);
    p.isPreview(B);
    p.isPreview(A);
    expect(reads).toBe(1);
    write(file, JSON.stringify({ groups: [B] }), 2000);
    p.isPreview(A);
    p.isPreview(B);
    expect(reads).toBe(2);
  });

  it('a file deleted after a good read is false', () => {
    const file = tmpFile();
    write(file, JSON.stringify({ groups: [A], people: [P] }), 1000);
    const p = openCmuPreview(file);
    expect(p.isPreview(A)).toBe(true);
    expect(p.isPreviewPerson(P)).toBe(true);
    rmSync(file);
    expect(p.isPreview(A)).toBe(false);
    expect(p.isPreviewPerson(P)).toBe(false);
  });

  it('never throws when stat or read throw', () => {
    const file = tmpFile();
    write(file, JSON.stringify({ groups: [A] }), 1000);
    const boom = () => { throw new Error('boom'); };
    expect(openCmuPreview(file, { statFn: boom as never }).isPreview(A)).toBe(false);
    expect(openCmuPreview(file, { readFn: boom as never }).isPreview(A)).toBe(false);
  });

  it('memoryCmuPreview', () => {
    expect(memoryCmuPreview([A]).isPreview(A)).toBe(true);
    expect(memoryCmuPreview([A]).isPreview(B)).toBe(false);
    expect(memoryCmuPreview().isPreview(A)).toBe(false);
    const m = memoryCmuPreview([A], [P]);
    expect(m.isPreviewPerson(P)).toBe(true);
    expect(m.isPreviewPerson(Q)).toBe(false);
    expect(m.isPreview(P)).toBe(false);
    expect(memoryCmuPreview().isPreviewPerson(P)).toBe(false);
  });

  it('the free isPreview / isPreviewPerson read cmuPreviewPath()', async () => {
    const file = tmpFile();
    write(file, JSON.stringify({ groups: [A], people: [P] }), 1000);
    const prev = process.env.DATA_DIR;
    try {
      process.env.DATA_DIR = path.dirname(file);
      vi.resetModules();
      const m = await import('../../src/bot/cmuPreview.js');
      expect(m.isPreview(A)).toBe(true);
      expect(m.isPreview(B)).toBe(false);
      expect(m.isPreviewPerson(P)).toBe(true);
      expect(m.isPreviewPerson(Q)).toBe(false);
      expect(m.defaultCmuPreview()).toBe(m.defaultCmuPreview());
      expect(m.defaultCmuPreview().isPreview(A)).toBe(m.isPreview(A));
      expect(m.defaultCmuPreview().isPreviewPerson(P)).toBe(m.isPreviewPerson(P));
    } finally {
      if (prev === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = prev;
    }
  });

  it('defaults to ${DATA_DIR ?? "data"}/cmu-preview.json', () => {
    const prev = process.env.DATA_DIR;
    try {
      process.env.DATA_DIR = '/x/y';
      expect(cmuPreviewPath()).toBe(path.resolve('/x/y', 'cmu-preview.json'));
      delete process.env.DATA_DIR;
      expect(cmuPreviewPath()).toBe(path.resolve('data', 'cmu-preview.json'));
    } finally {
      if (prev === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = prev;
    }
  });
});
