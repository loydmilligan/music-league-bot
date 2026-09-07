// Guard: a public hostname must be written down in exactly one place.
//
// The mlb37 -> mlb13 move touched 17 files because the host was inlined at a
// dozen call sites and baked into two out-of-process clients. These tests fail
// the moment that starts happening again.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { HOST_DEFAULTS } from './urls.js';

const REPO = join(import.meta.dirname, '..', '..', '..', '..');

/**
 * The only files allowed to spell a host out, and why:
 *   urls.ts            the single source of truth for the running app
 *   sync-hosts.mjs     mirrors .env out to the extension and the CMA prompt
 *   generate_ledes.py  runs under a systemd unit that passes only PATH, so it
 *                      reads .env itself and needs its own matching default
 * ...plus this file, which quotes the pattern it is guarding.
 */
const ALLOWED = new Set([
  'ui/src/lib/config/urls.ts',
  'ui/src/lib/config/hostLiterals.test.ts',
  'scripts/sync-hosts.mjs',
  'scripts/digest-qa/generate_ledes.py',
]);

const SCAN_ROOTS = ['ui/src', 'scripts'];
const SKIP_DIRS = new Set(['node_modules', '.svelte-kit', 'build', 'dist', '__pycache__']);
const SCAN_EXT = /\.(ts|js|mjs|cjs|svelte|py)$/;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (SCAN_EXT.test(name)) yield p;
  }
}

/** Comments and JSDoc may name a host in prose; only live code is the hazard. */
const isComment = (line: string): boolean => /^\s*(\/\/|\/\*|\*|#)/.test(line);

describe('public hostnames live in exactly one place', () => {
  it('no https://*.mattmariani.com literal in code outside the config module', () => {
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of walk(join(REPO, root))) {
        const rel = relative(REPO, file);
        if (ALLOWED.has(rel) || /\.test\.|\.spec\./.test(rel)) continue; // fixtures aren't config
        readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
          if (isComment(line)) return;
          if (/https:\/\/[a-z0-9-]+\.mattmariani\.com/i.test(line)) {
            offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 90)}`);
          }
        });
      }
    }
    expect(offenders, `import from $lib/config/urls.js instead:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('the config defaults are real https origins', () => {
    for (const url of Object.values(HOST_DEFAULTS)) {
      expect(url).toMatch(/^https:\/\/[a-z0-9.-]+$/);
      expect(url.endsWith('/')).toBe(false);
    }
  });

  // The extension and the CMA agent prompt cannot read .env at runtime, so they
  // hold generated copies. Without .env (CI, a fresh clone) there is nothing to
  // compare against and the check is meaningless rather than failing.
  it.skipIf(!existsSync(join(REPO, '.env')))(
    'extension + my-agent hosts are in sync with .env',
    () => {
      expect(() =>
        execFileSync('node', [join(REPO, 'scripts/sync-hosts.mjs'), '--check'], {
          cwd: REPO, stdio: 'pipe',
        }),
      ).not.toThrow();
    },
  );
});
