// Usage: npx tsx scripts/import-discord-chat.ts sssc ~/Downloads/MusicLeague-thread-log_2026-*.txt
import { readFileSync } from 'node:fs';
import { parseDiscordLog } from '../ui/src/lib/import/discordChat.ts';
import { ingestMessage } from '../src/storage/chatMessagesDb.ts';

const [groupName, ...files] = process.argv.slice(2);
if (!groupName || files.length === 0) {
  console.error('usage: import-discord-chat.ts <group_name> <file...>');
  process.exit(1);
}
let inserted = 0, total = 0;
for (const f of files) {
  const msgs = parseDiscordLog(readFileSync(f, 'utf-8'));
  for (const m of msgs) {
    total++;
    if (ingestMessage({ platform: 'discord', groupName, sender: m.sender, text: m.text, tsMs: m.tsMs })) inserted++;
  }
}
console.log(JSON.stringify({ inserted, skipped: total - inserted, total }));
