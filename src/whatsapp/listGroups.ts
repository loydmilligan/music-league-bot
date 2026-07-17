/**
 * Read-only diagnostic: report a message's raw address envelope so a group's
 * @g.us id can be learned by posting in it. Enabled by LOG_GROUPS=1.
 *
 * Why the envelope and not a Store lookup: EVERY Store method in this
 * whatsapp-web.js version is broken (`r: r` from inside the web page) —
 * getChats() AND getChat(). So neither the bulk list nor per-message chat
 * resolution works.
 *
 * The envelope fields (from/to/author) are plain properties on the message, not
 * Store calls, so they can't throw. And they carry the group id: msg.from is
 * your LID for your OWN messages (identical across every group), but msg.to is
 * then the destination — the group. For someone else's message it's reversed.
 * Checking both from and to for an @g.us finds the group either way.
 *
 * Reads; never sends.
 */

export interface MsgEnvelope {
  from: string;
  to: string;
  author?: string;
  fromMe: boolean;
}

export function formatEnvelope(e: MsgEnvelope): string {
  const groupId = [e.from, e.to].find((x) => x?.endsWith('@g.us'));
  const tag = groupId ? `group=${groupId}` : 'no @g.us id in this envelope';
  return `[groups] ${tag}  (from=${e.from} to=${e.to || '-'} author=${e.author ?? '-'} fromMe=${e.fromMe})`;
}
