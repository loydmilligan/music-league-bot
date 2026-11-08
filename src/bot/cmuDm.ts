import type Database from 'better-sqlite3';
import { parseCmuCommand, stripMentionAndFiller, type CmuCommand } from './cmuCommand.js';
import {
  CMU_OWNER_TIMEOUT_MS,
  commandLabel,
  runCatchMeUp,
  withDeadline,
  type CmuDeps,
  type CmuMessage,
} from './catchMeUp.js';
import { servedLeague } from './recapSubs.js';
import { latestSeenChat } from '../storage/reactionsDb.js';
import { NOOP_TRACE } from '../storage/interactionLog.js';
import type { WhatsAppMessage } from './handler.js';

/**
 * Player commands by private DM (R1, R4, R6, R8, C-DM1, H-DM, G2, G3).
 *
 * A DM is a command only for a preview person (G2), only when its whole text is a DM command,
 * and only when the author posted in a served CMU group in the last 30 days (R4). Anything else
 * returns false so the DM goes on to the prompt-answer path exactly as before. Replies go to the
 * DM chat only; nothing is sent to a group. No text or id reaches the trace or the log.
 */

/** R4: how far back the author's latest group post may be. */
export const DM_GROUP_WINDOW_MS = 30 * 86_400_000;

export type CmuDmDeps = CmuDeps & {
  /** league.db (wa_messages), read only. Called per DM, so it may open lazily. */
  leagueDb(): Pick<Database.Database, 'prepare'>;
};

/**
 * R4: the CMU_GROUPS group (of the served league only) holding the latest message by any of
 * `authorIds` within 30 days, or undefined.
 */
export function resolveDmGroup(
  authorIds: string[],
  groups: Map<string, string>,
  served: string | undefined,
  db: Pick<Database.Database, 'prepare'>,
  now: Date,
): string | undefined {
  if (!served) return undefined;
  const chats = [...groups].filter(([, league]) => league === served).map(([id]) => id);
  return latestSeenChat(db, authorIds, chats, new Date(now.getTime() - DM_GROUP_WINDOW_MS).toISOString());
}

/**
 * The DM author's dmTarget, bounded: it is a WhatsApp Web call in front of every DM prompt answer,
 * so a stall or throw gives undefined (treated as not a preview person) instead of a hang.
 */
async function boundedDmTarget(deps: CmuDeps, id: string): Promise<string | undefined> {
  if (!deps.dmTarget) return id;
  try {
    return (await withDeadline(Promise.resolve().then(() => deps.dmTarget!(id)), CMU_OWNER_TIMEOUT_MS)) || id;
  } catch {
    return undefined;
  }
}

async function safeOwner(deps: CmuDeps, id: string): Promise<boolean> {
  try {
    return deps.isOwner ? (await withDeadline(deps.isOwner(id), CMU_OWNER_TIMEOUT_MS)) === true : false;
  } catch {
    return false;
  }
}

/**
 * Sprint 4 (S2): commands that exist only behind the `format` allowlist: `recap7`, and the new
 * `morning-brief …` words (the old `morning-recap …` words work everywhere).
 */
function formatOnly(cmd: CmuCommand, body: string): boolean {
  if (cmd.kind === 'recap7') return true;
  if (cmd.kind !== 'recap-sub' && cmd.kind !== 'recap-unsub' && cmd.kind !== 'recap-time' && cmd.kind !== 'recap-time-bad') return false;
  return /^morning[- ]?brief\b/.test(stripMentionAndFiller(body));
}

function isFormatGroup(deps: CmuDeps, group: string): boolean {
  try {
    return deps.preview?.isFormatPreview?.(group) === true;
  } catch {
    return false;
  }
}

/** True when the DM was a command and was handled; false sends it on to prompt answers. */
export async function handleCmuDm(msg: WhatsAppMessage, deps: CmuDmDeps): Promise<boolean> {
  if (msg.fromMe || msg.from.endsWith('@g.us')) return false;

  // 0. Parse first (pure, no side effects): a non-command DM, the common prompt-answer case, pays no
  // dmTarget lookup. Exact whole-text DM commands only; owner kinds other than recap never parse here.
  const cmd = parseCmuCommand(msg.body, false, [], new Set(), { dm: true });
  if (!cmd) return false;

  // G2: preview people only. Nothing below acts (react, fetch, send, trace) before this gate passes.
  try {
    if (deps.preview?.hasPeople && !deps.preview.hasPeople()) return false;
  } catch {
    return false;
  }
  const target = await boundedDmTarget(deps, msg.from);
  if (target === undefined) return false;
  let previewPerson = false;
  try {
    previewPerson = deps.preview?.isPreviewPerson(target) === true;
  } catch {
    previewPerson = false;
  }
  if (!previewPerson) return false;

  // R6: recap-bot-calls is the owner's; anyone else falls through without a trace.
  if (cmd.kind === 'recap' && !(await safeOwner(deps, msg.from))) return false;

  // 2-3. R4: the author's group, trying both id forms.
  const authorIds = [...new Set([msg.from, target])];
  const served = servedLeague(deps.groups);
  let group: string | undefined;
  try {
    group = resolveDmGroup(authorIds, deps.groups, served, deps.leagueDb(), new Date((deps.now ?? Date.now)()));
  } catch (err) {
    deps.log(`[cmu] dm group lookup failed: ${err instanceof Error ? err.name : 'error'}`);
    group = undefined;
  }
  // S2: a format-only command is handled only when the resolved group is in `format`; otherwise
  // (no group included) it falls through untraced, exactly as before it parsed.
  if (formatOnly(cmd, msg.body) && !(group && isFormatGroup(deps, group))) return false;
  // The owner's recap needs no group of its own; any served group stands in for the league.
  if (!group && cmd.kind === 'recap') group = [...deps.groups].find(([, l]) => l === served)?.[0];
  if (!group) {
    let trace = NOOP_TRACE;
    try {
      trace = deps.trace?.() ?? NOOP_TRACE;
    } catch { /* never throw */ }
    try {
      trace.start({
        group: '', who: '', command: commandLabel(cmd), via: 'dm',
        authorKind: msg.from.endsWith('@lid') ? 'lid' : msg.from.endsWith('@c.us') ? 'c.us' : 'other',
      });
      trace.end('unknown-dm');
    } catch { /* never throw */ }
    deps.log('[cmu] unknown-dm; falls through');
    return false;
  }

  // 4. The DM as sprint 2's message: the group gives the league, the DM chat is the only DM target.
  const cmuMsg: CmuMessage = {
    from: group,
    author: msg.from,
    capturedAt: msg.capturedAt,
    notifyName: msg.notifyName,
    getContact: () => msg.getContact(),
    react: msg.react ? (emoji) => msg.react!(emoji) : undefined,
    previewPerson: true,
    via: 'dm',
  };

  // 5. runCatchMeUp dispatches catchup / help / recap / player and recap-* kinds, with the off switch.
  await runCatchMeUp(cmuMsg, deps, cmd);
  return true;
}
