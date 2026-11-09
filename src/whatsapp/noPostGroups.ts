import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Groups the bot must never send a message to, enforced where every send passes: client.sendMessage
 * and the message reply wrapper in client.ts. The owner's morning-brief sample is the one exception,
 * and it opts in with withAllowedGroupPost. Reactions don't send a message and are untouched.
 *
 * The list is data/no-post-groups.json (`{ "groups": ["...@g.us"] }`, gitignored because it holds raw
 * group ids), read on each check so a change needs no restart. A missing or unreadable list blocks
 * every group: this guard fails closed. DMs are never affected.
 */
export class GroupPostBlocked extends Error {
  constructor() {
    super('GroupPostBlocked');
    this.name = 'GroupPostBlocked';
  }
}

const allowed = new AsyncLocalStorage<true>();

export function noPostGroupsPath(): string {
  return path.resolve(process.env.DATA_DIR ?? 'data', 'no-post-groups.json');
}

/** The listed ids, or undefined when the file is missing or misshapen. */
function readList(): Set<string> | undefined {
  try {
    const d = JSON.parse(readFileSync(noPostGroupsPath(), 'utf8')) as { groups?: unknown };
    if (!Array.isArray(d?.groups)) return undefined;
    return new Set(d.groups.filter((g): g is string => typeof g === 'string'));
  } catch {
    return undefined;
  }
}

/** True only for an id on the list; a missing list is false here, unlike mayPost. */
export function isListedNoPost(chatId: string): boolean {
  return readList()?.has(chatId) === true;
}

export function mayPost(chatId: string): boolean {
  if (!chatId.endsWith('@g.us') || allowed.getStore()) return true;
  const list = readList();
  return list !== undefined && !list.has(chatId);
}

export function assertMayPost(chatId: string): void {
  if (mayPost(chatId)) return;
  console.warn('[no-post] blocked a message to a no-post group');
  throw new GroupPostBlocked();
}

/** Run one send that is allowed into a no-post group. Only the morning-brief sample uses this. */
export function withAllowedGroupPost<T>(fn: () => T): T {
  return allowed.run(true, fn);
}
