/**
 * Read-only diagnostic: print the bot's group ids next to their names.
 *
 * The JID of a group exists nowhere but the live WhatsApp session — the relay
 * stores a placeholder group_key, chat_mentions keeps only a display name, and
 * the session's LevelDB is encrypted. So there is no way to look up "which id is
 * the staging group" without asking the client. This makes the bot write it down.
 *
 * Enabled by LOG_GROUPS=1 at startup. getChats() reads; it never sends.
 */

export interface ChatLike {
  id: { _serialized: string };
  name: string;
  isGroup: boolean;
}

export function formatGroupList(chats: ChatLike[]): string {
  const groups = chats
    .filter((c) => c.isGroup)
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

  if (groups.length === 0) return '[groups] no groups found';

  const lines = groups.map((g) => `  ${g.id._serialized}  ${g.name || '(unnamed)'}`);
  return [`[groups] ${groups.length} group(s):`, ...lines].join('\n');
}
