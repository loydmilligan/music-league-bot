/**
 * Read-only diagnostic: report the true chat id + name of each message the bot
 * sees, so a group's JID can be learned by posting in it.
 *
 * Why per-message and not a bulk list: getChats() (the bulk list) is broken in
 * this whatsapp-web.js version (`r: r` from inside the web store). getChat() on a
 * single message still works. And crucially, msg.from is NOT the group for your
 * own messages — WhatsApp reports the sender's LID there, identically across
 * every group you post in. Only the resolved Chat carries the real @g.us id. A
 * group that is just you + bot never receives anyone else's message, so its id
 * can ONLY be learned this way.
 *
 * Enabled by LOG_GROUPS=1. Reads; never sends.
 */

export interface ChatLike {
  id: { _serialized: string };
  name: string;
  isGroup: boolean;
}

export function formatGroupSighting(chat: ChatLike): string {
  const kind = chat.isGroup ? 'GROUP' : 'not a group (DM)';
  return `[groups] ${chat.id._serialized}  "${chat.name || '(unnamed)'}"  ${kind}`;
}
