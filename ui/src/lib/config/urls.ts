// ── The only place a public hostname is written down ─────────────────────────
//
// Every public URL the app hands to the outside world resolves through here, so
// moving a host is a one-line `.env` edit plus a restart.
//
// Why this module exists: the app base URL used to be inlined as a `??` default
// at four call sites and the digest base at eight. When the mlb37 tunnel was
// retired (2026-09-06) each of those was a separate place to miss, and one of
// them — generate_ledes.py — had no env fallback at all and pushed dead links.
//
// Surfaces that CANNOT read this at runtime — the Chrome extension and the
// my-agent CMA prompt — are regenerated from `.env` by `scripts/sync-hosts.mjs`.
// `hostLiterals.test.ts` fails if a new hardcoded host appears anywhere.

/** Trailing slashes break `${base}/path`; strip them once, here. */
const clean = (u: string): string => u.replace(/\/+$/, '');

/** Fallbacks apply only when the variable is unset — `.env` is the source of truth. */
const DEFAULTS = {
  app: 'https://mlb13.mattmariani.com',
  digest: 'https://digest.mattmariani.com',
} as const;

/**
 * Public origin of the app itself (PUBLIC_APP_BASE_URL) — the host humans click
 * through to. Review links, HiL approvals and LLM `HTTP-Referer` headers.
 */
export const appBaseUrl = (): string => clean(process.env.PUBLIC_APP_BASE_URL || DEFAULTS.app);

/**
 * Public origin of the published-digest namespace (PUBLIC_DIGEST_BASE_URL) —
 * the static host share links point at. A different host from the app.
 */
export const digestBaseUrl = (): string => clean(process.env.PUBLIC_DIGEST_BASE_URL || DEFAULTS.digest);

/** Exported for the guard test, which asserts these are the only host literals. */
export const HOST_DEFAULTS = DEFAULTS;
