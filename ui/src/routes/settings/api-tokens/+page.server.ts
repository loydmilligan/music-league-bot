import type { PageServerLoad } from './$types.js';

export type TokenRow = {
  id: number;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export const load: PageServerLoad = async ({ fetch }) => {
  // Backend ships GET /api/tokens (planned shape per sprint-10.md). Fail soft —
  // page still renders an empty list + a clear error chip if the endpoint is
  // missing or 5xxes, so the operator can see the page exists even pre-T1.
  let tokens: TokenRow[] = [];
  let loadError: string | null = null;

  try {
    const res = await fetch('/api/tokens');
    if (!res.ok) {
      loadError = `GET /api/tokens → ${res.status}`;
    } else {
      const body = (await res.json()) as unknown;
      tokens = normalize(body);
    }
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  return { tokens, loadError };
};

// Defensively shape the response: backend's planned contract returns a flat
// array of { id, label, createdAt, lastUsedAt, revokedAt }, but some Node-ish
// idioms emit snake_case. Accept either form.
function normalize(body: unknown): TokenRow[] {
  const arr = Array.isArray(body)
    ? body
    : Array.isArray((body as { tokens?: unknown[] })?.tokens)
      ? (body as { tokens: unknown[] }).tokens
      : [];
  return arr.map((raw) => {
    const r = raw as Record<string, unknown>;
    return {
      id: Number(r.id),
      label: String(r.label ?? ''),
      createdAt: String(r.createdAt ?? r.created_at ?? ''),
      lastUsedAt: (r.lastUsedAt ?? r.last_used_at ?? null) as string | null,
      revokedAt: (r.revokedAt ?? r.revoked_at ?? null) as string | null,
    };
  });
}
