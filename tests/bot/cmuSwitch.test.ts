import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openCmuSwitch, cmuSwitchPath } from '../../src/bot/cmuSwitch.js';

const dirs: string[] = [];
function tmpFile(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cmu-switch-'));
  dirs.push(dir);
  return path.join(dir, 'nested', 'cmu-switch.json');
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('cmuSwitch', () => {
  it('a missing file is enabled', () => {
    expect(openCmuSwitch(tmpFile()).isEnabled()).toBe(true);
  });

  it('set(false) persists { enabled, at } and a fresh switch over the same file keeps it (restart)', () => {
    const file = tmpFile();
    const s = openCmuSwitch(file);
    s.set(false, new Date('2026-11-07T10:00:00.000Z'));
    expect(s.isEnabled()).toBe(false);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ enabled: false, at: '2026-11-07T10:00:00.000Z' });
    expect(openCmuSwitch(file).isEnabled()).toBe(false);

    s.set(true, new Date('2026-11-07T11:00:00.000Z'));
    expect(openCmuSwitch(file).isEnabled()).toBe(true);
    // Atomic write: no tmp file left beside it.
    expect(readdirSync(path.dirname(file))).toEqual(['cmu-switch.json']);
  });

  it.each(['not json', '{"enabled":"no"}', '[]', 'null', ''])('a corrupt file (%j) is enabled', (body) => {
    const file = tmpFile();
    openCmuSwitch(file).set(true, new Date()); // creates the directory
    writeFileSync(file, body);
    expect(openCmuSwitch(file).isEnabled()).toBe(true);
  });

  it('defaults to ${DATA_DIR ?? "data"}/cmu-switch.json', () => {
    const prev = process.env.DATA_DIR;
    try {
      process.env.DATA_DIR = '/x/y';
      expect(cmuSwitchPath()).toBe(path.resolve('/x/y', 'cmu-switch.json'));
      delete process.env.DATA_DIR;
      expect(cmuSwitchPath()).toBe(path.resolve('data', 'cmu-switch.json'));
    } finally {
      if (prev === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = prev;
    }
    expect(existsSync(path.resolve('/x/y'))).toBe(false);
  });
});
