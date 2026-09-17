import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPairSync, createSign, type KeyObject } from 'node:crypto';
import { createAccessVerifier } from './accessAuth.js';

const TEAM = 'https://example.cloudflareaccess.com';
const AUD = 'aud-tag-123';

let privateKey: KeyObject;
let otherKey: KeyObject;
let jwks: { keys: object[] };

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: Record<string, unknown>, key = privateKey, kid = 'k1', alg = 'RS256'): string {
  const head = b64url(JSON.stringify({ alg, kid, typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const s = createSign('RSA-SHA256');
  s.update(`${head}.${body}`);
  return `${head}.${body}.${b64url(s.sign(key))}`;
}

function claims(over: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return { iss: TEAM, aud: [AUD], email: 'matt@example.com', iat: now, nbf: now - 5, exp: now + 300, ...over };
}

beforeAll(() => {
  const kp = generateKeyPairSync('rsa', { modulusLength: 2048 });
  privateKey = kp.privateKey;
  otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  jwks = { keys: [{ ...kp.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }] };
});

function verifier(allowedEmails: string[] = [], allowedServiceTokens: string[] = []) {
  let fetches = 0;
  const v = createAccessVerifier({
    teamDomain: TEAM,
    audience: AUD,
    allowedEmails,
    allowedServiceTokens,
    fetchJwks: async () => {
      fetches++;
      return jwks;
    },
  });
  return { v, fetches: () => fetches };
}

describe('createAccessVerifier', () => {
  it('accepts a valid token and returns the email', async () => {
    const { v } = verifier();
    await expect(v(sign(claims()))).resolves.toEqual({ email: 'matt@example.com' });
  });

  it('caches the JWKS across calls', async () => {
    const { v, fetches } = verifier();
    await v(sign(claims()));
    await v(sign(claims()));
    expect(fetches()).toBe(1);
  });

  it('rejects a missing token', async () => {
    const { v } = verifier();
    await expect(v(undefined)).rejects.toThrow(/missing/);
  });

  it('rejects a token signed by another key', async () => {
    const { v } = verifier();
    await expect(v(sign(claims(), otherKey))).rejects.toThrow(/signature/);
  });

  it('rejects a tampered payload', async () => {
    const { v } = verifier();
    const [h, , sig] = sign(claims()).split('.');
    const forged = b64url(JSON.stringify(claims({ email: 'evil@example.com' })));
    await expect(v(`${h}.${forged}.${sig}`)).rejects.toThrow(/signature/);
  });

  it('rejects a non-RS256 alg', async () => {
    const { v } = verifier();
    await expect(v(sign(claims(), privateKey, 'k1', 'none'))).rejects.toThrow(/alg/);
  });

  it('rejects the wrong audience', async () => {
    const { v } = verifier();
    await expect(v(sign(claims({ aud: ['other-app'] })))).rejects.toThrow(/audience/);
  });

  it('rejects the wrong issuer', async () => {
    const { v } = verifier();
    await expect(v(sign(claims({ iss: 'https://evil.cloudflareaccess.com' })))).rejects.toThrow(/issuer/);
  });

  it('rejects an expired token', async () => {
    const { v } = verifier();
    await expect(v(sign(claims({ exp: Math.floor(Date.now() / 1000) - 120 })))).rejects.toThrow(/expired/);
  });

  it('rejects an unknown kid', async () => {
    const { v } = verifier();
    await expect(v(sign(claims(), privateKey, 'nope'))).rejects.toThrow(/key/);
  });

  it('enforces the email allowlist when one is configured', async () => {
    const { v } = verifier(['someone@else.com']);
    await expect(v(sign(claims()))).rejects.toThrow(/not allowed/);
    const { v: ok } = verifier(['MATT@example.com']);
    await expect(ok(sign(claims()))).resolves.toEqual({ email: 'matt@example.com' });
  });

  describe('service tokens', () => {
    // Access service-token JWTs have no email; common_name is the client id.
    const svc = (cn: string) => claims({ email: undefined, sub: '', common_name: cn });

    it('accepts an allowlisted service token by common_name', async () => {
      const { v } = verifier(['matt@example.com'], ['abc.access']);
      await expect(v(sign(svc('abc.access')))).resolves.toEqual({ serviceToken: 'abc.access' });
    });

    it('rejects a service token that is not allowlisted', async () => {
      const { v } = verifier([], ['abc.access']);
      await expect(v(sign(svc('other.access')))).rejects.toThrow(/service token not allowed/);
    });

    it('rejects every service token when no allowlist is configured', async () => {
      const { v } = verifier();
      await expect(v(sign(svc('abc.access')))).rejects.toThrow(/service token not allowed/);
    });

    it('rejects a token with neither email nor common_name', async () => {
      const { v } = verifier([], ['abc.access']);
      await expect(v(sign(claims({ email: undefined })))).rejects.toThrow(/not allowed: <none>/);
    });

    it('does not let an email token in via a common_name that is allowlisted', async () => {
      const { v } = verifier(['someone@else.com'], ['abc.access']);
      await expect(v(sign(claims({ common_name: 'abc.access' })))).rejects.toThrow(/email not allowed/);
    });
  });
});
