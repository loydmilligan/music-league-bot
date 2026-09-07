#!/usr/bin/env node
/**
 * ytm-refresh-endpoint — one-click YouTube token refresh from the ntfy topic.
 *
 * The mint script (.planning/spikes/001a-.../mint-youtube-refresh-token.mjs) is
 * interactive and terminal-driven. This is the same OAuth flow exposed as a tiny
 * always-on local endpoint, so the "Refresh now" button on an mlbot-alerts
 * notification works when the topic is open in a browser ON THIS LAPTOP.
 *
 * Why loopback is the whole trick: Google's installed-app flow redirects consent
 * back to 127.0.0.1. A phone can't reach that, but the laptop's own browser can —
 * so opening ntfy here makes the button real. From the phone it just won't
 * connect, which is the honest failure.
 *
 *   GET /start?k=<YTM_REFRESH_KEY>   -> 302 to Google consent
 *   GET /callback?code=..&state=..   -> exchanges code, writes .env, success page
 *   GET /health                      -> ok
 *
 * Binds 127.0.0.1 only, and /start requires the shared key so a random web page
 * can't kick off an OAuth flow behind your back.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = path.join(ROOT, '.env');
const SCOPE = 'https://www.googleapis.com/auth/youtube';

function parseEnv() {
  const out = {};
  if (!fs.existsSync(ENV_PATH)) return out;
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
/** Upsert KEY=value, preserving the rest. Same discipline as the mint script. */
function writeEnv(updates) {
  fs.copyFileSync(ENV_PATH, ENV_PATH + '.bak-ytm-refresh');
  let text = fs.readFileSync(ENV_PATH, 'utf8');
  for (const [k, v] of Object.entries(updates)) {
    const re = new RegExp(`^${k}=.*$`, 'm');
    text = re.test(text) ? text.replace(re, `${k}=${v}`) : text.replace(/\n?$/, `\n${k}=${v}\n`);
  }
  fs.writeFileSync(ENV_PATH, text);
}

const env = parseEnv();
const PORT = Number(env.YTM_REFRESH_PORT || 4577);
const KEY = env.YTM_REFRESH_KEY || '';
if (!KEY) { console.error('[fatal] YTM_REFRESH_KEY not set in .env'); process.exit(1); }
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;

// state -> issued time; single-use, 10 minute TTL.
const pending = new Map();

const page = (title, body, ok = true) => `<!doctype html><meta charset=utf-8>
<title>${title}</title><body style="font:16px/1.6 system-ui;max-width:34rem;margin:4rem auto;padding:0 1rem;
background:#111;color:#eee"><h1 style="color:${ok ? '#7ddf7d' : '#ff7b7b'}">${title}</h1>${body}</body>`;

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    if (url.pathname === '/health') { res.writeHead(200).end('ok'); return; }

    if (url.pathname === '/start') {
      if (url.searchParams.get('k') !== KEY) {
        res.writeHead(403, { 'Content-Type': 'text/html' })
           .end(page('Forbidden', '<p>Bad or missing key.</p>', false));
        return;
      }
      const e = parseEnv();
      if (!e.YOUTUBE_CLIENT_ID || !e.YOUTUBE_CLIENT_SECRET) {
        res.writeHead(500, { 'Content-Type': 'text/html' })
           .end(page('Not configured', '<p>YOUTUBE_CLIENT_ID / SECRET missing from .env.</p>', false));
        return;
      }
      const state = crypto.randomBytes(16).toString('hex');
      pending.set(state, Date.now());
      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      auth.searchParams.set('client_id', e.YOUTUBE_CLIENT_ID);
      auth.searchParams.set('redirect_uri', REDIRECT_URI);
      auth.searchParams.set('response_type', 'code');
      auth.searchParams.set('scope', SCOPE);
      auth.searchParams.set('access_type', 'offline');
      auth.searchParams.set('prompt', 'consent'); // force a NEW refresh token
      auth.searchParams.set('state', state);
      res.writeHead(302, { Location: auth.toString() }).end();
      return;
    }

    if (url.pathname === '/callback') {
      const state = url.searchParams.get('state');
      const code = url.searchParams.get('code');
      const issued = state ? pending.get(state) : undefined;
      if (!issued || Date.now() - issued > 600_000) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
           .end(page('Expired or unknown request', '<p>Start again from the notification.</p>', false));
        return;
      }
      pending.delete(state); // single use
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
           .end(page('No code returned', `<p>${url.searchParams.get('error') ?? 'unknown error'}</p>`, false));
        return;
      }
      const e = parseEnv();
      const tokRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code, client_id: e.YOUTUBE_CLIENT_ID, client_secret: e.YOUTUBE_CLIENT_SECRET,
          redirect_uri: REDIRECT_URI, grant_type: 'authorization_code',
        }).toString(),
      });
      const tok = await tokRes.json();
      if (!tokRes.ok || !tok.refresh_token) {
        res.writeHead(500, { 'Content-Type': 'text/html' }).end(page('Token exchange failed',
          `<pre>${JSON.stringify(tok.error_description ?? tok, null, 2)}</pre>`, false));
        return;
      }
      const mintedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
      writeEnv({ YOUTUBE_REFRESH_TOKEN: tok.refresh_token, YOUTUBE_TOKEN_MINTED_AT: mintedAt });
      console.log(`[ok] refreshed; minted_at=${mintedAt}`);
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(page('Token refreshed ✅',
        `<p>New refresh token written to <code>.env</code> (backup at <code>.env.bak-ytm-refresh</code>).</p>
         <p>Minted <code>${mintedAt}</code> — the alert ladder resets automatically.</p>
         <p>You can close this tab.</p>`));
      return;
    }

    res.writeHead(404).end('not found');
  } catch (err) {
    console.error('[error]', err);
    res.writeHead(500, { 'Content-Type': 'text/html' }).end(page('Server error', `<pre>${err.message}</pre>`, false));
  }
}).listen(PORT, '127.0.0.1', () => console.log(`[info] ytm-refresh-endpoint on http://127.0.0.1:${PORT}`));
