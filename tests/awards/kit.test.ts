import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { zipStore } from '../../src/awards/zip.js';
import { buildKitZip } from '../../src/awards/kit.js';
import { parseAwardCommand } from '../../src/awards/commands.js';
import type { AwardDef } from '../../src/awards/types.js';

const def: AwardDef = {
  key: 'bbb', prefix: 'bbb', name: 'Test Award', owners: ['1@c.us'], approvers: ['1@c.us'],
  day: 1, window: 'round', promptTemplate: 'bbb.md',
};

function unzipList(buf: Buffer): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'zip-'));
  const f = path.join(dir, 'x.zip');
  writeFileSync(f, buf);
  execFileSync('unzip', ['-tq', f]); // throws on a bad archive or CRC
  return execFileSync('unzip', ['-Z1', f], { encoding: 'utf8' });
}

describe('zipStore', () => {
  it('writes an archive unzip accepts, with every file and correct contents', () => {
    const buf = zipStore([
      { name: 'a.txt', data: Buffer.from('hello') },
      { name: 'b.bin', data: Buffer.from([0, 1, 2, 255]) },
    ]);
    expect(unzipList(buf).trim().split('\n')).toEqual(['a.txt', 'b.bin']);
    const dir = mkdtempSync(path.join(tmpdir(), 'unz-'));
    const f = path.join(dir, 'x.zip');
    writeFileSync(f, buf);
    expect(execFileSync('unzip', ['-p', f, 'a.txt'], { encoding: 'utf8' })).toBe('hello');
  });
});

describe('buildKitZip', () => {
  let kits: string;
  beforeEach(() => {
    kits = mkdtempSync(path.join(tmpdir(), 'kits-'));
    mkdirSync(path.join(kits, 'avatars'));
    writeFileSync(path.join(kits, 'bbb-style-reference.png'), 'STYLE');
    writeFileSync(path.join(kits, 'avatars', 'ann.png'), 'ANN');
    writeFileSync(path.join(kits, 'avatars', 'bob.png'), 'BOB');
  });

  it('bundles prompt, style reference and avatars, and lists none missing', () => {
    const { zip, missing } = buildKitZip({ kitsDir: kits, def, prompt: 'PROMPT', avatars: ['bob.png', 'ann.png', 'bob.png'] });
    expect(missing).toEqual([]);
    expect(unzipList(zip).trim().split('\n')).toEqual(['prompt.md', 'style-reference.png', 'bob.png', 'ann.png']);
  });

  it('reports a missing avatar or style reference instead of failing', () => {
    const { zip, missing } = buildKitZip({ kitsDir: kits, def: { ...def, key: 'hba' }, prompt: 'P', avatars: ['ann.png', 'zed.png', 'bob.png'] });
    expect(missing).toEqual(['hba-style-reference.png', 'zed.png']);
    expect(unzipList(zip).trim().split('\n')).toEqual(['prompt.md', 'ann.png', 'bob.png', 'MISSING.txt']);
  });

  it('never reads outside the kits dir', () => {
    const { missing } = buildKitZip({ kitsDir: kits, def, prompt: 'P', avatars: ['../../etc/passwd'] });
    expect(missing).toEqual(['../../etc/passwd']);
  });
});

describe('kit command', () => {
  it('parses "<prefix> kit"', () => {
    expect(parseAwardCommand('BBB kit', ['bbb', 'hba'])).toEqual({ award: 'bbb', kind: 'kit' });
    expect(parseAwardCommand('hba kit', ['bbb', 'hba'])).toEqual({ award: 'hba', kind: 'kit' });
  });
});
