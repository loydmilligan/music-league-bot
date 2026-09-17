import { createPublicKey, createVerify, type JsonWebKey, type KeyObject } from 'node:crypto';

// Verifies the Cf-Access-Jwt-Assertion header Cloudflare Access adds to every
// request it lets through. The HTTP entrypoint listens on the LAN (cloudflared
// runs on another host), so this check — not network placement — is what
// keeps LAN clients from bypassing Access. Stdlib only: RS256 over the team's
// published JWKS.

export interface AccessVerifierOptions {
  /** e.g. https://loydmilligan.cloudflareaccess.com */
  teamDomain: string;
  /** The Access application's AUD tag. */
  audience: string;
  /** Optional defense-in-depth allowlist; empty = trust the Access policy. */
  allowedEmails?: string[];
  fetchJwks?: (url: string) => Promise<{ keys: object[] }>;
  /** How long to trust a fetched JWKS before refetching. */
  jwksTtlMs?: number;
}

export type AccessVerifier = (token: string | undefined) => Promise<{ email: string }>;

const CLOCK_SKEW_S = 60;

async function defaultFetchJwks(url: string): Promise<{ keys: object[] }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  return (await res.json()) as { keys: object[] };
}

function decodePart(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
}

export function createAccessVerifier(opts: AccessVerifierOptions): AccessVerifier {
  const issuer = opts.teamDomain.replace(/\/+$/, '');
  const certsUrl = `${issuer}/cdn-cgi/access/certs`;
  const fetchJwks = opts.fetchJwks ?? defaultFetchJwks;
  const ttl = opts.jwksTtlMs ?? 60 * 60 * 1000;
  const allowed = new Set((opts.allowedEmails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean));

  let keys = new Map<string, KeyObject>();
  let fetchedAt = 0;

  async function loadKeys(force: boolean): Promise<void> {
    if (!force && keys.size && Date.now() - fetchedAt < ttl) return;
    const jwks = await fetchJwks(certsUrl);
    const next = new Map<string, KeyObject>();
    for (const jwk of jwks.keys as Array<JsonWebKey & { kid?: string }>) {
      if (jwk.kid && jwk.kty === 'RSA') next.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
    }
    keys = next;
    fetchedAt = Date.now();
  }

  return async (token) => {
    if (!token) throw new Error('missing Access token');
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('malformed token');
    const [h, p, sig] = parts;

    const header = decodePart(h);
    if (header.alg !== 'RS256') throw new Error(`unsupported alg: ${String(header.alg)}`);
    const kid = String(header.kid ?? '');

    await loadKeys(false);
    // Access rotates signing keys; refetch once before rejecting an unseen kid.
    if (!keys.has(kid)) await loadKeys(true);
    const key = keys.get(kid);
    if (!key) throw new Error('unknown signing key');

    const v = createVerify('RSA-SHA256');
    v.update(`${h}.${p}`);
    if (!v.verify(key, Buffer.from(sig, 'base64url'))) throw new Error('bad signature');

    const claims = decodePart(p);
    if (claims.iss !== issuer) throw new Error('wrong issuer');
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(opts.audience)) throw new Error('wrong audience');
    const now = Math.floor(Date.now() / 1000);
    if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < now) throw new Error('token expired');
    if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_S > now) throw new Error('token not yet valid');

    const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
    if (allowed.size && !allowed.has(email)) throw new Error(`email not allowed: ${email || '<none>'}`);
    return { email };
  };
}
