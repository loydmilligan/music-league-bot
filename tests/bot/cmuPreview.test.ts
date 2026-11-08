import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openCmuPreview, memoryCmuPreview, cmuPreviewPath, addPreviewOwnerId, registerPreviewOwner, isFormatPreview } from '../../src/bot/cmuPreview.js';

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

  describe('"*" entry in people means everyone', () => {
    const fileGate = (people: unknown[], groups: unknown[] = []) => {
      const file = tmpFile();
      write(file, JSON.stringify({ groups, people }), 1000);
      return openCmuPreview(file, { ownerIds: () => [] });
    };
    const gates: Array<[string, (people: string[], groups?: string[]) => ReturnType<typeof memoryCmuPreview>]> = [
      ['file-backed', (p, g = []) => fileGate(p, g)],
      ['memory', (p, g = []) => memoryCmuPreview(g, p)],
    ];

    it.each(gates)('%s: people ["*"] matches any non-empty id, never the empty id', (_n, mk) => {
      const p = mk(['*']);
      expect(p.isPreviewPerson(P)).toBe(true);
      expect(p.isPreviewPerson(Q)).toBe(true);
      expect(p.isPreviewPerson('15550000009@c.us')).toBe(true);
      expect(p.isPreviewPerson('')).toBe(false);
      expect(p.hasPeople?.()).toBe(true);
      expect(p.isPreview(A)).toBe(false);
    });

    it.each(gates)('%s: groups ["*"] matches nothing', (_n, mk) => {
      const p = mk([], ['*', A]);
      expect(p.isPreview('*')).toBe(false);
      expect(p.isPreview(B)).toBe(false);
      expect(p.isPreview(P)).toBe(false);
      expect(p.isPreview(A)).toBe(true);
      expect(mk([], ['*']).isPreview(A)).toBe(false);
    });

    it.each(gates)('%s: people ["owner","*"] still works', (_n, mk) => {
      const p = mk(['owner', '*']);
      expect(p.isPreviewPerson(P)).toBe(true);
      expect(p.isPreviewPerson('')).toBe(false);
      expect(p.hasPeople?.()).toBe(true);
    });

    it('memory gate: "owner" with "*" and an owner id matches both', () => {
      const m = memoryCmuPreview([], ['owner', '*'], [P]);
      expect(m.isPreviewPerson(P)).toBe(true);
      expect(m.isPreviewPerson(Q)).toBe(true);
    });
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

  describe('"owner" entry in people', () => {
    const OWNER_PHONE = '15550000001';
    const OWNER_C_US = '15550000001@c.us';
    const OWNER_LID = '100000000000001@lid';
    let prevEnv: string | undefined;
    const setEnv = (v: string | undefined): void => {
      prevEnv = process.env.OWNER_PHONE_NUMBER;
      if (v === undefined) delete process.env.OWNER_PHONE_NUMBER;
      else process.env.OWNER_PHONE_NUMBER = v;
    };
    afterEach(() => {
      if (prevEnv === undefined) delete process.env.OWNER_PHONE_NUMBER;
      else process.env.OWNER_PHONE_NUMBER = prevEnv;
    });
    function ownerFile(people: unknown[] = ['owner'], groups: unknown[] = []): string {
      const file = tmpFile();
      write(file, JSON.stringify({ groups, people }), 1000);
      return file;
    }

    it('matches the OWNER_PHONE_NUMBER env id (normalised to @c.us) read lazily', () => {
      setEnv(undefined);
      const p = openCmuPreview(ownerFile());
      expect(p.isPreviewPerson(OWNER_C_US)).toBe(false);
      process.env.OWNER_PHONE_NUMBER = OWNER_PHONE;
      expect(p.isPreviewPerson(OWNER_C_US)).toBe(true);
      expect(p.isPreviewPerson('15550000002@c.us')).toBe(false);
    });

    it('keeps an env value that already has an @ as is', () => {
      setEnv(OWNER_LID);
      expect(openCmuPreview(ownerFile()).isPreviewPerson(OWNER_LID)).toBe(true);
    });

    it('matches ids registered with addPreviewOwnerId, including via the default instance', async () => {
      setEnv(undefined);
      vi.resetModules();
      const m = await import('../../src/bot/cmuPreview.js');
      const file = ownerFile();
      const p = m.openCmuPreview(file);
      expect(p.isPreviewPerson(OWNER_LID)).toBe(false);
      m.addPreviewOwnerId('');
      m.addPreviewOwnerId(OWNER_LID);
      expect(p.isPreviewPerson(OWNER_LID)).toBe(true);
      expect(p.isPreviewPerson('')).toBe(false);
      expect(p.isPreviewPerson('100000000000002@lid')).toBe(false);
      const prev = process.env.DATA_DIR;
      try {
        process.env.DATA_DIR = path.dirname(file);
        expect(m.isPreviewPerson(OWNER_LID)).toBe(true);
      } finally {
        if (prev === undefined) delete process.env.DATA_DIR;
        else process.env.DATA_DIR = prev;
      }
    });

    it('fails closed when no owner is known', () => {
      setEnv(undefined);
      const p = openCmuPreview(ownerFile());
      expect(p.isPreviewPerson(OWNER_C_US)).toBe(false);
      expect(p.isPreviewPerson('owner')).toBe(false);
      expect(p.isPreviewPerson('')).toBe(false);
    });

    it('literal ids keep working alongside "owner"; "owner" in groups means nothing', () => {
      setEnv(OWNER_PHONE);
      const p = openCmuPreview(ownerFile([P, 'owner'], ['owner', A]));
      expect(p.isPreviewPerson(P)).toBe(true);
      expect(p.isPreviewPerson(OWNER_C_US)).toBe(true);
      expect(p.isPreviewPerson(Q)).toBe(false);
      expect(p.isPreview('owner')).toBe(false);
      expect(p.isPreview(OWNER_C_US)).toBe(false);
      expect(p.isPreview(A)).toBe(true);
    });

    it('without "owner" in people, owner ids do not match', () => {
      setEnv(OWNER_PHONE);
      expect(openCmuPreview(ownerFile([P])).isPreviewPerson(OWNER_C_US)).toBe(false);
    });

    it('openCmuPreview accepts an ownerIds override', () => {
      setEnv(OWNER_PHONE);
      const p = openCmuPreview(ownerFile(), { ownerIds: () => [Q] });
      expect(p.isPreviewPerson(Q)).toBe(true);
      expect(p.isPreviewPerson(OWNER_C_US)).toBe(false);
    });

    it('memoryCmuPreview takes owner ids as a third parameter', () => {
      const m = memoryCmuPreview([A], ['owner', P], [OWNER_LID]);
      expect(m.isPreviewPerson(OWNER_LID)).toBe(true);
      expect(m.isPreviewPerson(P)).toBe(true);
      expect(m.isPreviewPerson(Q)).toBe(false);
      expect(m.isPreview('owner')).toBe(false);
      expect(memoryCmuPreview([], [Q], [OWNER_LID]).isPreviewPerson(OWNER_LID)).toBe(false);
    });

    it('registerPreviewOwner registers the resolved id', async () => {
      setEnv(undefined);
      vi.resetModules();
      const m = await import('../../src/bot/cmuPreview.js');
      const logs: string[] = [];
      await m.registerPreviewOwner(async () => '100000000000009@lid', OWNER_PHONE, (l) => logs.push(l));
      expect(logs).toEqual([]);
      expect(m.openCmuPreview(ownerFile()).isPreviewPerson('100000000000009@lid')).toBe(true);
    });

    it('hasPeople reflects whether any person is listed', () => {
      expect(memoryCmuPreview([], []).hasPeople?.()).toBe(false);
      expect(memoryCmuPreview([], ['100000000000001@lid']).hasPeople?.()).toBe(true);
    });

    it('registerPreviewOwner resolves, logs, and registers nothing when dmTarget rejects', async () => {
      setEnv(undefined);
      vi.resetModules();
      const m = await import('../../src/bot/cmuPreview.js');
      const logs: string[] = [];
      await expect(
        m.registerPreviewOwner(() => Promise.reject(new Error('x 100000000000009@lid')), OWNER_PHONE, (l) => logs.push(l)),
      ).resolves.toBeUndefined();
      expect(logs).toEqual(['[preview] owner id lookup failed']);
      expect(m.openCmuPreview(ownerFile()).isPreviewPerson('100000000000009@lid')).toBe(false);
    });
  });
});

describe('format allowlist', () => {
  it('matches only listed ids, exactly', () => {
    const file = tmpFile();
    write(file, JSON.stringify({ groups: [B], format: [A] }), 1000);
    const p = openCmuPreview(file);
    expect(p.isFormatPreview!(A)).toBe(true);
    expect(p.isFormatPreview!(B)).toBe(false);
    expect(p.isFormatPreview!('x' + A)).toBe(false);
    expect(p.isFormatPreview!('')).toBe(false);
    expect(p.isPreview(A)).toBe(false);
  });

  it('missing key, missing file or corrupt file means false for all', () => {
    const file = tmpFile();
    write(file, JSON.stringify({ groups: [A] }), 1000);
    expect(openCmuPreview(file).isFormatPreview!(A)).toBe(false);
    expect(openCmuPreview(path.join(path.dirname(file), 'nope.json')).isFormatPreview!(A)).toBe(false);
    write(file, '{not json', 2000);
    expect(openCmuPreview(file).isFormatPreview!(A)).toBe(false);
  });

  it('"*" and "owner" entries match nothing', () => {
    const file = tmpFile();
    write(file, JSON.stringify({ format: ['*', 'owner', A] }), 1000);
    const p = openCmuPreview(file);
    expect(p.isFormatPreview!('*')).toBe(false);
    expect(p.isFormatPreview!('owner')).toBe(false);
    expect(p.isFormatPreview!(B)).toBe(false);
    expect(p.isFormatPreview!(A)).toBe(true);
  });

  it('re-reads when the mtime changes', () => {
    const file = tmpFile();
    write(file, JSON.stringify({ format: [A] }), 1000);
    const p = openCmuPreview(file);
    expect(p.isFormatPreview!(A)).toBe(true);
    write(file, JSON.stringify({ format: [B] }), 2000);
    expect(p.isFormatPreview!(A)).toBe(false);
    expect(p.isFormatPreview!(B)).toBe(true);
  });

  it('memoryCmuPreview takes format as the 4th param', () => {
    const m = memoryCmuPreview([A], [], [], [B, '*', 'owner']);
    expect(m.isFormatPreview!(B)).toBe(true);
    expect(m.isFormatPreview!(A)).toBe(false);
    expect(m.isFormatPreview!('*')).toBe(false);
    expect(m.isFormatPreview!('owner')).toBe(false);
    expect(memoryCmuPreview().isFormatPreview!(A)).toBe(false);
  });

  it('free isFormatPreview is false with no file', () => {
    expect(isFormatPreview(A)).toBe(false);
  });
});
