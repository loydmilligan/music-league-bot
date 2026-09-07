#!/usr/bin/env node
// Push the hostnames in .env out to the surfaces that cannot read .env.
//
// The app resolves every public URL through ui/src/lib/config/urls.ts at
// runtime, so a host move is a one-line .env edit. Two surfaces live outside
// that process and hold their own copy:
//
//   extension/  — a Chrome extension. manifest host_permissions and the
//                 default base URL are baked in at load time.
//   my-agent/   — the CMA agent's system prompt and build sheet, uploaded to
//                 Anthropic. The agent curls the app by absolute URL.
//
// Run after editing .env:  node scripts/sync-hosts.mjs        (apply)
//                          node scripts/sync-hosts.mjs --check (verify only)
//
// --check is what hostLiterals.test.ts calls, so a forgotten sync fails the
// suite instead of silently shipping a dead hostname.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

/** Same defaults as ui/src/lib/config/urls.ts — kept in step by the guard test. */
const DEFAULTS = { app: 'https://mlb13.mattmariani.com', digest: 'https://digest.mattmariani.com' };

export function readEnv(path = join(REPO, '.env')) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch { return {}; }
  const out = {};
  for (const line of raw.split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

/** The host each managed file must carry, and which variable governs it. */
export const MANAGED = [
  { file: 'extension/manifest.json', kind: 'app' },
  { file: 'extension/background.js', kind: 'app' },
  { file: 'extension/options.js', kind: 'app' },
  { file: 'extension/options.html', kind: 'app' },
  { file: 'extension/README.md', kind: 'app' },
  { file: 'my-agent/agent.json', kind: 'app' },
  { file: 'my-agent/build-sheet.json', kind: 'app' },
  { file: 'my-agent/LAUNCH.md', kind: 'app' },
  { file: 'my-agent/agent-overview.html', kind: 'app' },
];

/** Any *.mattmariani.com origin, so a stale host is rewritten rather than missed. */
const ORIGIN = /https:\/\/[a-z0-9-]+\.mattmariani\.com/gi;
/** agent-overview.html also prints the bare host outside a URL. */
const BARE = /(?<!\/\/)\b[a-z0-9-]+\.mattmariani\.com/gi;

export function syncFile(file, want, { check }) {
  const path = join(REPO, file);
  const before = readFileSync(path, 'utf8');
  const host = want.replace(/^https:\/\//, '');
  // Never touch the digest host — it is a different service on its own tunnel.
  const keep = (m) => m.includes('digest.mattmariani.com');
  const after = before
    .replace(ORIGIN, (m) => (keep(m) ? m : want))
    .replace(BARE, (m) => (keep(m) ? m : host));
  if (after === before) return { file, changed: false };
  if (!check) writeFileSync(path, after);
  return { file, changed: true };
}

const env = readEnv();
const want = { app: (env.PUBLIC_APP_BASE_URL || DEFAULTS.app).replace(/\/+$/, ''),
               digest: (env.PUBLIC_DIGEST_BASE_URL || DEFAULTS.digest).replace(/\/+$/, '') };

const results = MANAGED.map((m) => syncFile(m.file, want[m.kind], { check: CHECK }));
const stale = results.filter((r) => r.changed);

if (CHECK) {
  if (stale.length) {
    console.error(`out of sync with .env (${want.app}):`);
    for (const r of stale) console.error(`  ${r.file}`);
    console.error('run: node scripts/sync-hosts.mjs');
    process.exit(1);
  }
  console.log(`all ${results.length} managed files match ${want.app}`);
} else {
  console.log(`app host: ${want.app}`);
  for (const r of results) console.log(`  ${r.changed ? 'updated' : 'ok     '}  ${r.file}`);
}
