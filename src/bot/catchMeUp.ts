import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * "@bot catch me up": DM the requester a picture of what they missed.
 *
 * The bot only does the plumbing here. companelist (POST CMU_URL) picks the
 * window, writes the text and returns card HTML; the bot screenshots that HTML
 * with WhatsApp's own Chromium and DMs the PNG plus the topic links to the
 * request's author. The group sees one 👍 (or ⏳ when over the limit) and
 * nothing else. Logs carry outcome + group id only, never text or names.
 */

export const CMU_FAILURE_TEXT = "Couldn't build your catch-up just now. Try again in a few minutes.";
export const CMU_TIMEOUT_MS = 60_000;

const TRIGGER = /^\s*(catch\s*(me)?\s*up|cmu|what did i miss)\b/i;

/** C1: a bot mention whose text after the mention starts with a catch-up phrase. */
export function isCatchMeUpRequest(text: string, mentionsBot: boolean): boolean {
  if (!mentionsBot) return false;
  // The body carries the mention as a leading "@<id>" token; strip it.
  const rest = text.replace(/^\s*@\S+\s*/u, '');
  return TRIGGER.test(rest);
}

/** CMU_GROUPS="<groupId>@g.us=<instance>,..." → Map(groupId → instance). */
export function parseCmuGroups(env: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const pair of (env ?? '').split(',')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const id = pair.slice(0, eq).trim();
    const instance = pair.slice(eq + 1).trim();
    if (id && instance) map.set(id, instance);
  }
  return map;
}

export interface CmuMessage {
  from: string;          // group chat id
  author: string;        // requester id (@lid or @c.us); the only DM target
  capturedAt: string;    // ISO timestamp of the request message
  notifyName?: string;   // WhatsApp display name from the message payload
  getContact(): Promise<{ pushname: string }>;
  react?(emoji: string): Promise<void>;
}

export interface CmuDeps {
  fetchFn: typeof fetch;
  groups: Map<string, string>;
  url: string;
  token: string;
  screenshot(html: string, outPath: string): Promise<void>;
  sendImage(chatId: string, filePath: string): Promise<void>;
  sendText(chatId: string, text: string): Promise<void>;
  log(line: string): void;
}

type CmuResult =
  | { kind: 'card'; html: string; links: string[] }
  | { kind: 'quiet'; text: string };

class CmuHttpError extends Error {
  constructor(readonly status: number) {
    super(`http ${status}`);
  }
}

function parseResult(data: unknown): CmuResult | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.kind === 'card' && typeof d.html === 'string' && Array.isArray(d.links)
      && d.links.every((l) => typeof l === 'string')) {
    return { kind: 'card', html: d.html, links: d.links as string[] };
  }
  if (d.kind === 'quiet' && typeof d.text === 'string') return { kind: 'quiet', text: d.text };
  return null;
}

/** Redacted error summary: a class of failure, never a message body. */
function describeError(err: unknown): string {
  if (err instanceof CmuHttpError) return err.message;
  if (err instanceof Error) return err.name;
  return 'error';
}

async function resolveNotifyName(msg: CmuMessage): Promise<string> {
  if (msg.notifyName) return msg.notifyName;
  try {
    return (await msg.getContact()).pushname || '';
  } catch {
    return ''; // companelist treats an unknown name as "last 24h" (C6)
  }
}

async function react(msg: CmuMessage, emoji: string, deps: CmuDeps): Promise<void> {
  try {
    await msg.react?.(emoji);
  } catch (err) {
    deps.log(`[cmu] react failed in ${msg.from}: ${describeError(err)}`);
  }
}

export async function runCatchMeUp(msg: CmuMessage, deps: CmuDeps): Promise<void> {
  const group = msg.from;
  if (!deps.groups.has(group)) {
    deps.log(`[cmu] unsupported group ${group}; ignored`);
    return;
  }

  await react(msg, '👍', deps);

  try {
    const notifyName = await resolveNotifyName(msg);
    const res = await deps.fetchFn(deps.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${deps.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ notifyName, requestAt: msg.capturedAt }),
      signal: AbortSignal.timeout(CMU_TIMEOUT_MS),
    });

    if (res.status === 429) {
      await react(msg, '⏳', deps);
      deps.log(`[cmu] limit in ${group}`);
      return;
    }
    if (!res.ok) throw new CmuHttpError(res.status);

    const result = parseResult(await res.json());
    if (!result) throw new Error('BadResponse');

    if (result.kind === 'quiet') {
      await deps.sendText(msg.author, result.text);
      deps.log(`[cmu] quiet sent in ${group}`);
      return;
    }

    const pngPath = path.join(os.tmpdir(), `cmu-${randomUUID()}.png`);
    try {
      await deps.screenshot(result.html, pngPath);
      await deps.sendImage(msg.author, pngPath);
      if (result.links.length) await deps.sendText(msg.author, result.links.join('\n'));
    } finally {
      await rm(pngPath, { force: true }).catch(() => undefined);
    }
    deps.log(`[cmu] card sent in ${group}`);
  } catch (err) {
    deps.log(`[cmu] failed in ${group}: ${describeError(err)}`);
    try {
      await deps.sendText(msg.author, CMU_FAILURE_TEXT);
    } catch (dmErr) {
      deps.log(`[cmu] failure DM failed in ${group}: ${describeError(dmErr)}`);
    }
  }
}
