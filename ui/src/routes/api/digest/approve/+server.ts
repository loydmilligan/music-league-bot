import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { approveJob } from '$lib/digest/approvals.js';
import { bearerOk } from '$lib/digest/callbackAuth.js';

const uiBase = process.env.BOT_UI_INTERNAL_URL ?? 'http://localhost:3002';
const botControlUrl = process.env.BOT_CONTROL_URL ?? 'http://bot:3003';

export const POST: RequestHandler = async ({ request }) => {
  if (!bearerOk(request.headers.get('authorization'), process.env.NTFY_TOKEN)) {
    return json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { token?: unknown };
  const token = typeof body.token === 'string' ? body.token : '';

  const result = await approveJob(getDb(), token, {
    finalize: async (roundId) => {
      const res = await fetch(`${uiBase}/api/digest/${roundId}/finalize`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: 'pdf' }),
      });
      if (!res.ok) throw new Error(`finalize ${res.status}`);
    },
    triggerSend: async () => {
      const res = await fetch(`${botControlUrl}/trigger`, { method: 'POST' });
      if (!res.ok) throw new Error(`trigger ${res.status}`);
    },
    now: () => new Date().toISOString(),
  });
  return json(result, { status: result.ok ? 200 : 400 });
};
