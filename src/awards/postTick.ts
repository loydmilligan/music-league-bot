import type Database from 'better-sqlite3';
import { laNow } from '../bot/recapSubs.js';
import { withAllowedGroupPost } from '../whatsapp/noPostGroups.js';
import { awardLinks, buildCaption } from './caption.js';
import { dayAt } from './schedule.js';
import type { AwardStore } from './store.js';
import type { AwardDef, AwardRound } from './types.js';

export interface AwardPostTickDeps {
  store: AwardStore;
  db: Database.Database;
  now(): Date;
  sendImage(chatId: string, file: string, caption: string): Promise<void>;
  recapUrlFor(ymd: string): Promise<string | null>;
  republish(roundId: number): Promise<void>;
  dmOwner(award: string, text: string): Promise<void>;
  log(line: string): void;
  intervalMs?: number;
  autoStart?: boolean;
}

const GRACE_MS = 3 * 3600_000;
const errName = (e: unknown): string => (e instanceof Error ? e.name : 'error');

/**
 * The only code path that posts an award into a group. Marks the round posted before sending, so a
 * crash or failed send never double-posts; a retry is a manual re-approve. Never throws.
 */
export function startAwardPostTick(deps: AwardPostTickDeps): { tick(): Promise<void>; stop(): void } {
  let running = false;

  const dm = async (def: AwardDef, text: string): Promise<void> => {
    try { await deps.dmOwner(def.key, text); } catch (e) { deps.log(`[awards] owner dm failed: ${errName(e)}`); }
  };

  async function handle(def: AwardDef, seen: AwardRound): Promise<void> {
    const config = deps.store.config();
    const share = deps.db.prepare('SELECT slug, created_at AS releasedAt FROM digest2_shares WHERE round_id = ?').get(seen.roundId) as
      | { slug: string | null; releasedAt: string | null } | undefined;
    if (!share?.releasedAt || !share.slug || !seen.approvedAt) return;
    const postAt = new Date(Math.max(dayAt(share.releasedAt, def.day).getTime(), dayAt(seen.approvedAt, 1).getTime()));
    const now = deps.now();
    if (now.getTime() < postAt.getTime()) return;

    if (now.getTime() > postAt.getTime() + GRACE_MS) {
      const cur = deps.store.get(def.key, seen.roundId);
      if (!cur.approvedAt || cur.postedAt || cur.skipped) return;
      deps.store.put({ ...cur, skipped: now.toISOString() });
      deps.log(`[awards] skipped ${def.key} round ${seen.roundId}: past the posting window`);
      await dm(def, `Missed the posting window for ${def.name}; nothing was posted.`);
      return;
    }

    let recap: string | null = null;
    try { recap = await deps.recapUrlFor(laNow(now).ymd); } catch (e) { deps.log(`[awards] recap check failed: ${errName(e)}`); }

    // Re-read after the await and mark posted with no await in between.
    const cur = deps.store.get(def.key, seen.roundId);
    if (!cur.approvedAt || cur.postedAt || cur.skipped || !cur.poster) return;
    deps.store.put({ ...cur, postedAt: now.toISOString() });
    const caption = buildCaption(def, cur, { ...awardLinks(config, def, share.slug), recap });

    try {
      await withAllowedGroupPost(() => deps.sendImage(config.postGroup, cur.poster!, caption));
    } catch (e) {
      deps.log(`[awards] post failed ${def.key} round ${seen.roundId}: ${errName(e)}`);
      deps.store.put({ ...deps.store.get(def.key, seen.roundId), postFailed: true });
      const detail = e instanceof Error ? `${e.name}: ${e.message}` : 'error';
      await dm(def, `Couldn't post ${def.name}: ${detail}. It won't retry; re-approve to try again.`);
      return;
    }
    deps.log(`[awards] posted ${def.key} round ${seen.roundId}`);
    try { await deps.republish(seen.roundId); } catch (e) { deps.log(`[awards] republish failed: ${errName(e)}`); }
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
        try { await handle(def, r); } catch (e) { deps.log(`[awards] tick failed for ${r.award}: ${errName(e)}`); }
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
