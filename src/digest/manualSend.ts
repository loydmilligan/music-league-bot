/**
 * Manual, operator-driven send of ANY round's digest to ANY group.
 *
 * Separate from the scheduled auto-post: it does not consult the resolver (so it
 * can send a round the scheduler would never pick — e.g. one that isn't the
 * latest), and it deliberately does NOT touch digest_sends. The claim table is
 * the auto-post idempotency ledger; a manual test send must not consume a round's
 * scheduled slot or mark it "sent".
 *
 * It still goes through guardedSend, so the @g.us check, the mode gate, and the
 * empty-body refusal all apply exactly as a scheduled send.
 */
import { guardedSend } from '../whatsapp/sendGuard.js';
import { formatDigestMessage } from './autoPost.js';

export interface ManualSendDeps {
  /** Render the round's share page and return its name + public url. */
  render: (roundId: number) => Promise<{ name: string; url: string }>;
  send: (target: string, text: string) => Promise<void>;
  log: (msg: string) => void;
}

export interface ManualSendReq {
  roundId: number;
  target: string;
  mode: string;
}

export interface ManualSendResult {
  sent: boolean;
  reason: string;
  preview?: string;
}

export async function runManualSend(
  deps: ManualSendDeps,
  req: ManualSendReq,
): Promise<ManualSendResult> {
  let rendered: { name: string; url: string };
  try {
    rendered = await deps.render(req.roundId);
  } catch (err) {
    const reason = `render failed: ${err instanceof Error ? err.message : String(err)}`;
    deps.log(`[manual] round ${req.roundId}: ${reason}`);
    return { sent: false, reason };
  }

  const text = formatDigestMessage(rendered.name, rendered.url);
  const env = { mode: req.mode, targets: { manual: req.target } };
  const r = await guardedSend(env, 'manual', text, deps.send);

  deps.log(
    `[manual] round ${req.roundId} → ${req.target} [${req.mode}] ${r.sent ? 'SENT' : 'not sent'}: ${r.reason}\n${r.preview}`,
  );
  return { sent: r.sent, reason: r.reason, preview: r.preview };
}
