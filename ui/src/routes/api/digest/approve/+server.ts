import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { claimApproval, completeApproval } from '$lib/digest/approvals.js';
import { bearerOk } from '$lib/digest/callbackAuth.js';

const uiBase = process.env.BOT_UI_INTERNAL_URL ?? 'http://localhost:3002';
const botControlUrl = process.env.BOT_CONTROL_URL ?? 'http://bot:3003';
const now = () => new Date().toISOString();

export const POST: RequestHandler = async ({ request }) => {
  if (!bearerOk(request.headers.get('authorization'), process.env.NTFY_TOKEN)) {
    return json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { token?: unknown };
  const token = typeof body.token === 'string' ? body.token : '';

  // Fast-ack: consume the single-use token synchronously and return 200 right
  // away. The ntfy action that POSTs here has a ~15s timeout, but finalize
  // (rel-context LLM + PDF) plus the send (render + WhatsApp) take far longer —
  // so we run them in the background. The digest_sends ledger already guarantees
  // exactly-once, and the token is already consumed, so a client retry on a slow
  // response is a no-op (returns "already-used"). A background failure marks the
  // job `failed` (visible + requeue-able).
  const claim = claimApproval(getDb(), token, now);
  if (!claim.ok || claim.roundId === undefined) return json(claim, { status: 400 });
  const roundId = claim.roundId;

  void completeApproval(getDb(), roundId, {
    finalize: async (rid) => {
      const res = await fetch(`${uiBase}/api/digest/${rid}/finalize`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: 'pdf' }),
      });
      if (!res.ok) throw new Error(`finalize ${res.status}`);
    },
    triggerSend: async () => {
      const res = await fetch(`${botControlUrl}/trigger`, { method: 'POST' });
      if (!res.ok) throw new Error(`trigger ${res.status}`);
    },
    now,
  }).catch((e) => console.error(`[approve] round ${roundId} background completion failed:`, e instanceof Error ? e.message : e));

  return json({ ok: true, roundId }, { status: 200 });
};
