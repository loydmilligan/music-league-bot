import type Database from 'better-sqlite3';
import { laNow } from '../bot/recapSubs.js';
import { withAllowedGroupPost } from '../whatsapp/noPostGroups.js';
import { awardLinks, buildCaption } from './caption.js';
import { awardPeople, fullyApproved } from './model.js';
import { postAtFor } from './schedule.js';
import type { AwardStore } from './store.js';
import type { AwardDef, AwardRound } from './types.js';

export interface AwardPostTickDeps {
  store: AwardStore;
  db: Database.Database;
  now(): Date;
  sendImage(chatId: string, file: string, caption: string): Promise<void>;
  recapUrlFor(ymd: string): Promise<string | null>;
  republish(roundId: number): Promise<void>;
  /** Direct message to one person (chat id); used for the award's owners and approvers. */
  sendText(to: string, text: string): Promise<void>;
  log(line: string): void;
  intervalMs?: number;
  autoStart?: boolean;
}

const GRACE_MS = 3 * 3600_000;
const errName = (e: unknown): string => (e instanceof Error ? e.name : 'error');

/**
 * recapUrlFor for the bot: HEAD the recap page without following redirects. Only an exact 200
 * counts; the returned URL is the one built here, never a redirect target.
 */
export function makeRecapUrlFor(fetchFn: typeof fetch, baseUrl: () => string): (ymd: string) => Promise<string | null> {
  return async (ymd) => {
    const url = `${baseUrl().replace(/\/+$/, '')}/recap-${ymd}.html`;
    try {
      const res = await fetchFn(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(5000) });
      return res.status === 200 ? url : null;
    } catch {
      return null;
    }
  };
}

/**
 * The only code path that posts an award into a group. Marks the round posted before sending, so a
 * crash or failed send never double-posts; a retry is a manual re-approve. Never throws.
 */
export function startAwardPostTick(deps: AwardPostTickDeps): { tick(): Promise<void>; stop(): void } {
  let running = false;

  /** DM the award's owners and approvers (deduped); one failure doesn't stop the rest. */
  const dm = async (def: AwardDef, text: string): Promise<void> => {
    for (const to of awardPeople(def)) {
      try { await deps.sendText(to, text); } catch (e) { deps.log(`[awards] dm failed: ${errName(e)}`); }
    }
  };

  const ready = (def: AwardDef, r: AwardRound): boolean =>
    !!r.approvedAt && fullyApproved(def, r) && !r.postedAt && !r.skipped && !!r.poster;

  async function handle(def: AwardDef, roundId: number): Promise<void> {
    const config = deps.store.config();
    const share = deps.db.prepare('SELECT slug, created_at AS releasedAt FROM digest2_shares WHERE round_id = ?').get(roundId) as
      | { slug: string | null; releasedAt: string | null } | undefined;
    if (!share?.releasedAt || !share.slug) return;
    // Fresh read: the tick's snapshot can be stale after an earlier round's awaits.
    const first = deps.store.get(def.key, roundId);
    if (!ready(def, first)) return;
    const postAt = postAtFor(share.releasedAt, def.day, first.approvedAt!);
    const now = deps.now();
    if (postAt && now.getTime() < postAt.getTime()) return;

    if (!postAt || now.getTime() > postAt.getTime() + GRACE_MS) {
      const cur = deps.store.get(def.key, roundId);
      if (!cur.approvedAt || cur.postedAt || cur.skipped) return;
      deps.store.put({ ...cur, skipped: now.toISOString() });
      deps.log(`[awards] skipped ${def.key} round ${roundId}: past the posting window`);
      await dm(def, `Missed the posting window for ${def.name}; nothing was posted.`);
      return;
    }

    let recap: string | null = null;
    try { recap = await deps.recapUrlFor(laNow(now).ymd); } catch (e) { deps.log(`[awards] recap check failed: ${errName(e)}`); }

    // Re-read after the await and mark posted with no await in between.
    const cur = deps.store.get(def.key, roundId);
    if (!ready(def, cur) || cur.approvedAt !== first.approvedAt) return;
    deps.store.put({ ...cur, postedAt: now.toISOString() });
    const caption = buildCaption(def, cur, { ...awardLinks(config, def, share.slug), recap });

    try {
      await withAllowedGroupPost(() => deps.sendImage(config.postGroup, cur.poster!, caption));
    } catch (e) {
      deps.log(`[awards] post failed ${def.key} round ${roundId}: ${errName(e)}`);
      deps.store.put({ ...deps.store.get(def.key, roundId), postFailed: true });
      const detail = e instanceof Error ? `${e.name}: ${e.message}` : 'error';
      await dm(def, `Couldn't post ${def.name}: ${detail}. Check the group first; it may have posted. Re-approve only if it didn't.`);
      return;
    }
    deps.store.put({ ...deps.store.get(def.key, roundId), sentAt: deps.now().toISOString() });
    deps.log(`[awards] posted ${def.key} round ${roundId}`);
    try {
      await deps.republish(roundId);
    } catch (e) {
      deps.log(`[awards] republish failed ${def.key} round ${roundId}: ${errName(e)}`);
      await dm(def, `Posted ${def.name}, but the digest didn't refresh, so the Awards link may not show it yet.`);
      return;
    }
    await dm(def, `Posted ${def.name}.`);
  }

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const config = deps.store.config();
      for (const r of deps.store.all()) {
        const def = config.awards.find((a) => a.key === r.award);
        if (!def || !r.approvedAt || r.postedAt || r.skipped) continue;
        try { await handle(def, r.roundId); } catch (e) { deps.log(`[awards] tick failed for ${r.award}: ${errName(e)}`); }
      }
    } catch (e) {
      deps.log(`[awards] tick failed: ${errName(e)}`);
    } finally {
      running = false;
    }
  }

  const timer = deps.autoStart === false ? undefined : setInterval(() => void tick(), deps.intervalMs ?? 60_000);
  timer?.unref?.();
  return { tick, stop: () => { if (timer) clearInterval(timer); } };
}
