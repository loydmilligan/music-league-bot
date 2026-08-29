// MINT — one-time, interactive: mint a youtube-scoped Google OAuth refresh
// token for playlist creation on Matt's PERSONAL account.
//
// Adapted from mara-college-tracker/scripts/mint-drive-refresh-token.mjs
// (proven loopback installed-app flow, same Desktop OAuth client). Differences:
//   - requests ONLY https://www.googleapis.com/auth/youtube
//   - client id/secret come from this repo's .env (YOUTUBE_CLIENT_ID/SECRET)
//     or fall back to mara's .env (GOOGLE_OAUTH_CLIENT_ID/SECRET)
//   - on success the token is written straight into this repo's .env
//     (gitignored) as YOUTUBE_REFRESH_TOKEN — never printed, never committed
//
// Run it (Matt, on the laptop with a browser):
//   node .planning/spikes/001a-ytm-playlist-data-api/mint-youtube-refresh-token.mjs

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const SCOPES = ["https://www.googleapis.com/auth/youtube"];
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const TOKENINFO_ENDPOINT = "https://oauth2.googleapis.com/tokeninfo";

const REPO = resolve(join(fileURLToPath(import.meta.url), "../../../..")); // → repo root
const ENV_PATH = join(REPO, ".env");
const MARA_ENV = join(homedir(), "Projects/mara-college-tracker/.env");

function parseEnv(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function resolveClient() {
  const repoEnv = parseEnv(ENV_PATH);
  if (repoEnv.YOUTUBE_CLIENT_ID && repoEnv.YOUTUBE_CLIENT_SECRET) {
    return { clientId: repoEnv.YOUTUBE_CLIENT_ID, clientSecret: repoEnv.YOUTUBE_CLIENT_SECRET, source: ".env (YOUTUBE_*)" };
  }
  const mara = parseEnv(MARA_ENV);
  if (mara.GOOGLE_OAUTH_CLIENT_ID && mara.GOOGLE_OAUTH_CLIENT_SECRET) {
    return { clientId: mara.GOOGLE_OAUTH_CLIENT_ID, clientSecret: mara.GOOGLE_OAUTH_CLIENT_SECRET, source: "mara-college-tracker/.env" };
  }
  throw new Error("No OAuth client found: set YOUTUBE_CLIENT_ID/SECRET in .env, or check mara-college-tracker/.env");
}

// Upsert KEY=value lines into .env, preserving everything else. Backs up first.
function writeEnv(updates) {
  copyFileSync(ENV_PATH, ENV_PATH + ".bak-ytm-mint");
  let text = readFileSync(ENV_PATH, "utf8");
  for (const [k, v] of Object.entries(updates)) {
    const line = `${k}=${v}`;
    const re = new RegExp(`^${k}=.*$`, "m");
    text = re.test(text) ? text.replace(re, line) : text.replace(/\n?$/, `\n${line}\n`);
  }
  writeFileSync(ENV_PATH, text);
}

function tryOpen(url) {
  try {
    const child = spawn("xdg-open", [url], { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch { /* printed URL is the fallback */ }
}

async function main() {
  const { clientId, clientSecret, source } = resolveClient();
  console.log(`Using OAuth client from: ${source}`);

  const server = await new Promise((res, rej) => {
    const s = createServer();
    s.on("error", rej);
    s.listen(0, "127.0.0.1", () => res(s));
  });
  const { port } = server.address();
  const redirectUri = `http://127.0.0.1:${port}`;
  const state = randomBytes(16).toString("hex");

  const codePromise = new Promise((res, rej) => {
    server.on("request", (req, r) => {
      const params = new URL(req.url, "http://127.0.0.1").searchParams;
      const err = params.get("error");
      const code = params.get("code");
      r.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      r.end(`<!doctype html><meta charset=utf-8><body style='font-family:system-ui;padding:2rem'><h1>${err ? "Consent failed: " + err : "Done — close this tab and return to the terminal."}</h1></body>`);
      server.close();
      if (err) return rej(new Error(`Consent denied/failed: ${err}`));
      if (params.get("state") !== state) return rej(new Error("State mismatch — aborting."));
      if (!code) return rej(new Error("No authorization code on the callback."));
      res(code);
    });
  });

  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);

  console.log("\nOpen this URL and click Allow (should open automatically):\n\n" + url.toString() + "\n");
  tryOpen(url.toString());
  console.log("Waiting for the consent redirect…");

  const code = await codePromise;
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }).toString(),
  });
  if (!res.ok) throw new Error(`Token exchange failed (HTTP ${res.status})`);
  const tokens = await res.json();
  if (!tokens.refresh_token) throw new Error("No refresh_token returned — re-run (prompt=consent should force one).");

  let grantedScope = "(tokeninfo unavailable)";
  try {
    const info = await fetch(`${TOKENINFO_ENDPOINT}?access_token=${encodeURIComponent(tokens.access_token)}`);
    if (info.ok) grantedScope = (await info.json()).scope ?? grantedScope;
  } catch { /* best-effort */ }

  writeEnv({
    YOUTUBE_CLIENT_ID: clientId,
    YOUTUBE_CLIENT_SECRET: clientSecret,
    YOUTUBE_REFRESH_TOKEN: tokens.refresh_token,
  });

  console.log("\n=== SUCCESS — YOUTUBE_* written to .env (backup at .env.bak-ytm-mint) ===");
  console.log("Granted scope (should be youtube only):\n  " + grantedScope);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
