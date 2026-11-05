import type Database from 'better-sqlite3';
import { appBaseUrl } from '$lib/config/urls.js';
import { getDb } from '$lib/db/client.js';
import { getActiveDraftForRound } from '$lib/digest/llm.js';
import type { Notification } from '$lib/digest/ntfy.js';
import type { FetchLike } from '../avatarFactory/openrouter.js';
import { buildStyleHilNotification, mintHilToken, publishStyleHil } from '../avatarFactory/hil.js';
import { HARD_CAP_USD, STALE_RUN_MS, STEP_ESTIMATE_USD, reclaimStaleSlots, roundSpend, runSlot, type AutoDeps, type SlotOutcome } from './autoRun.js';
import { autoLeagues, isAutoLeague, isHandMade, matchSubmission, medalItems, setAutoLeague, writePodiumCover, type PodiumSlot } from './podium.js';
import { ApiError } from './service.js';

type DB = Database.Database;

/** ntfy topic for the round budget approval (not the avatar factory's HIL topic). */
export const COVER_AUTO_TOPIC = 'mlb-alert';
export const DEFAULT_CAP_USD = 1.0;
export const APPROVED_CAP_USD = HARD_CAP_USD;
export const APPROVAL_TIMEOUT_MS = 24 * 60 * 60_000;
/** One full cover from scratch (read + identity + pitch + one generate). */
export const NEXT_COVER_ESTIMATE_USD = STEP_ESTIMATE_USD.read + STEP_ESTIMATE_USD.identity + STEP_ESTIMATE_USD.pitch + STEP_ESTIMATE_USD.generate;
export const BUDGET_DENIED_NOTE = 'budget not approved';
export const HAND_MADE_NOTE = 'hand-made cover kept';
export const NOTIFY_FAILED_NOTE = 'approval notification failed';

export type JobStatus = 'queued' | 'running' | 'awaiting_approval' | 'done' | 'failed';
export interface CoverAutoJob {
	id: number;
	round_id: number;
	status: JobStatus;
	cap_usd: number;
	hil_token: string | null;
	notified_at: string | null;
	created_at: string;
	updated_at: string;
}

export interface TickDeps extends Omit<AutoDeps, 'notify'> {
	/** Sends the budget ntfy. Default: publish to `mlb-alert` on NTFY_URL. */
	notify?: (n: Notification) => Promise<boolean>;
	/** Test seam; defaults to autoRun.runSlot. */
	runSlot?: typeof runSlot;
}

const iso = (ms: number) => new Date(ms).toISOString();

export function getAutoJob(db: DB, roundId: number): CoverAutoJob | undefined {
	return db.prepare('SELECT * FROM cover_auto_jobs WHERE round_id = ?').get(roundId) as CoverAutoJob | undefined;
}

/**
 * Queue the round's automatic covers. ON leagues only (OFF → null, nothing read or written beyond the
 * league lookup). Creates a slot per medal item of the active draft's podium (hand-made covers →
 * `skipped`), keeps existing slots (done stays done), and creates or reuses the round's job:
 * a non-terminal job is reused as-is; a terminal one is re-queued at the $1.00 cap.
 * `retryFailed` (operator "run now") also puts failed slots back to pending.
 */
export function enqueueCoverAuto(
	db: DB, roundId: number, opts: { retryFailed?: boolean; now?: number } = {},
): { job: CoverAutoJob; created: number } | null {
	if (!isAutoLeague(db, roundId)) return null;
	const draft = getActiveDraftForRound(db, roundId);
	if (!draft) return null;
	const row = db.prepare(`SELECT content_json FROM digest_sections WHERE draft_id = ? AND kind = 'podium'`).get(draft.id) as
		{ content_json: string } | undefined;
	if (!row) return null;
	let content: unknown;
	try {
		content = JSON.parse(row.content_json);
	} catch {
		return null;
	}
	const medals = medalItems(content);
	if (medals.length === 0) return null;

	const stamp = iso(opts.now ?? Date.now());
	let created = 0;
	db.transaction(() => {
		const insert = db.prepare(
			`INSERT OR IGNORE INTO cover_podium_slots (round_id, rank, title, submission_id, status, note, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		);
		for (const m of medals) {
			const hand = isHandMade(m.coverUrl, roundId);
			created += insert.run(
				roundId, m.rank, m.title, matchSubmission(db, roundId, m),
				hand ? 'skipped' : 'pending', hand ? HAND_MADE_NOTE : null, stamp,
			).changes;
		}
		if (opts.retryFailed) {
			db.prepare(`UPDATE cover_podium_slots SET status = 'pending', note = NULL, updated_at = ? WHERE round_id = ? AND status = 'failed'`)
				.run(stamp, roundId);
		}
		const job = getAutoJob(db, roundId);
		if (!job) {
			db.prepare(
				`INSERT INTO cover_auto_jobs (round_id, status, cap_usd, created_at, updated_at) VALUES (?, 'queued', ?, ?, ?)`,
			).run(roundId, DEFAULT_CAP_USD, stamp, stamp);
		} else if (job.status === 'done' || job.status === 'failed') {
			db.prepare(
				`UPDATE cover_auto_jobs SET status = 'queued', cap_usd = ?, hil_token = NULL, notified_at = NULL, updated_at = ? WHERE id = ?`,
			).run(DEFAULT_CAP_USD, stamp, job.id);
		}
	})();
	return { job: getAutoJob(db, roundId)!, created };
}

/** Operator "run now" (POST /api/cover-factory `{action:'run-auto', roundId}`): queue the round, failed slots retried; the poller runs it. */
export function runAutoAction(db: DB, b: Record<string, unknown>): { job: CoverAutoJob; created: number } {
	const roundId = Number(b.roundId);
	if (!Number.isInteger(roundId) || roundId <= 0) throw new ApiError(400, 'roundId required');
	if (!isAutoLeague(db, roundId)) throw new ApiError(400, 'automatic covers are off for this league');
	const r = enqueueCoverAuto(db, roundId, { retryFailed: true });
	if (!r) throw new ApiError(400, 'no podium on the active draft');
	return r;
}

/** Publish to `mlb-alert` via the avatar HIL helpers, overriding only the topic for this call. */
export function publishCoverAutoAlert(
	n: Notification, opts: { env?: Record<string, string | undefined>; fetchImpl?: FetchLike } = {},
): Promise<boolean> {
	const env = { ...(opts.env ?? process.env), AVATAR_FACTORY_HIL_TOPIC: COVER_AUTO_TOPIC };
	return publishStyleHil(n, { env, fetchImpl: opts.fetchImpl });
}

export function buildBudgetNotification(
	roundId: number, spent: number, token: string, o: { base?: string; bearer?: string } = {},
): Notification {
	const root = (o.base ?? appBaseUrl()).replace(/\/+$/, '');
	return buildStyleHilNotification({
		title: `Cover Factory R${roundId}: budget`,
		message: `Cover Factory R${roundId}: $${spent.toFixed(2)} spent, next cover needs ~$${NEXT_COVER_ESTIMATE_USD.toFixed(2)} — approve up to $${APPROVED_CAP_USD.toFixed(2)}?`,
		click: `${root}/cover-factory`,
		approveUrl: `${root}/api/cover-factory/auto/approve`,
		denyUrl: `${root}/api/cover-factory/auto/deny`,
		token,
		bearer: o.bearer,
	});
}

function setJob(db: DB, id: number, fields: Partial<Omit<CoverAutoJob, 'id' | 'round_id' | 'created_at'>>, now: number): void {
	const keys = Object.keys(fields);
	const sets = [...keys.map((k) => `${k} = @${k}`), 'updated_at = @updated_at'].join(', ');
	db.prepare(`UPDATE cover_auto_jobs SET ${sets} WHERE id = @id`).run({ ...fields, updated_at: iso(now), id });
}

/** Deny / timeout / undeliverable ntfy: every still-pending slot fails with `note`; the job is done. */
function closeUnapproved(db: DB, job: CoverAutoJob, now: number, note = BUDGET_DENIED_NOTE): void {
	db.prepare(`UPDATE cover_podium_slots SET status = 'failed', note = ?, updated_at = ? WHERE round_id = ? AND status = 'pending'`)
		.run(note, iso(now), job.round_id);
	setJob(db, job.id, { status: 'done', hil_token: null }, now);
	writePodiumCover(db, job.round_id);
}

/** Approve (cap → $2.00, re-queued) or deny an awaiting job by its single-use ntfy token. */
export function resolveCoverAutoApproval(
	db: DB, token: string, decision: 'approve' | 'deny', now = Date.now(),
): { ok: true; job: CoverAutoJob } | { ok: false; reason: string } {
	if (!token) return { ok: false, reason: 'invalid token' };
	// Past the 24 h deadline the token is dead even if no tick has timed the job out yet.
	const job = db
		.prepare(`SELECT * FROM cover_auto_jobs WHERE hil_token = ? AND status = 'awaiting_approval' AND notified_at >= ?`)
		.get(token, iso(now - APPROVAL_TIMEOUT_MS)) as
		CoverAutoJob | undefined;
	if (!job) return { ok: false, reason: 'invalid token' };
	if (decision === 'approve') setJob(db, job.id, { status: 'queued', cap_usd: APPROVED_CAP_USD, hil_token: null }, now);
	else closeUnapproved(db, job, now);
	return { ok: true, job: getAutoJob(db, job.round_id)! };
}

let ticking = false;

/**
 * One poll: time out stale approvals, then take ONE queued job and run its pending slots one after
 * another (runSlot's budget gate is check-then-spend, so slots of a round must never overlap).
 * Only one tick runs at a time in this process; a concurrent call returns null immediately.
 */
export async function tickCoverAuto(db: DB, deps: TickDeps = {}): Promise<{ roundId: number; status: JobStatus } | null> {
	if (ticking) return null;
	ticking = true;
	try {
		return await tick(db, deps);
	} finally {
		ticking = false;
	}
}

async function tick(db: DB, deps: TickDeps): Promise<{ roundId: number; status: JobStatus } | null> {
	const now = () => (deps.now ?? Date.now)();
	const t = now();

	// Approvals nobody answered within 24 h count as denied.
	const expired = db.prepare(`SELECT * FROM cover_auto_jobs WHERE status = 'awaiting_approval' AND notified_at < ?`)
		.all(iso(t - APPROVAL_TIMEOUT_MS)) as CoverAutoJob[];
	for (const j of expired) closeUnapproved(db, j, t);

	// A job left `running` by a crashed process (no tick is live here) goes back to the queue.
	db.prepare(`UPDATE cover_auto_jobs SET status = 'queued', updated_at = ? WHERE status = 'running' AND updated_at < ?`)
		.run(iso(t), iso(t - STALE_RUN_MS));

	const job = db.prepare(`SELECT * FROM cover_auto_jobs WHERE status = 'queued' ORDER BY updated_at, id LIMIT 1`).get() as
		CoverAutoJob | undefined;
	if (!job) return null;
	if (db.prepare(`UPDATE cover_auto_jobs SET status = 'running', updated_at = ? WHERE id = ? AND status = 'queued'`).run(iso(t), job.id).changes === 0) {
		return null;
	}
	const run = deps.runSlot ?? runSlot;
	const roundId = job.round_id;
	// runSlot only reclaims inside a claim of a pending slot; a crashed run's slot must be freed first.
	reclaimStaleSlots(db, roundId, STALE_RUN_MS, t);
	const nextPending = () =>
		db.prepare(`SELECT id FROM cover_podium_slots WHERE round_id = ? AND status = 'pending' ORDER BY rank, id LIMIT 1`).get(roundId) as
			{ id: number } | undefined;

	try {
		const seen = new Set<number>();
		for (let slot = nextPending(); slot && !seen.has(slot.id); slot = nextPending()) {
			seen.add(slot.id);
			setJob(db, job.id, {}, now()); // job heartbeat
			const outcome: SlotOutcome = await run(db, roundId, slot.id, { capUsd: job.cap_usd }, { fetchImpl: deps.fetchImpl, now: deps.now });
			if (outcome === 'needs_approval') return await park(db, job, deps, now());
			if (outcome === 'paused' || outcome === 'running') {
				setJob(db, job.id, { status: 'queued' }, now()); // retry on a later tick
				return { roundId, status: 'queued' };
			}
		}
		// Not finished: a slot still running (fresh heartbeat, e.g. another process), or one put back to
		// pending after this tick already passed it (operator run-now mid-tick). Retry on a later tick.
		if (db.prepare(`SELECT 1 FROM cover_podium_slots WHERE round_id = ? AND status IN ('running', 'pending') LIMIT 1`).get(roundId)) {
			setJob(db, job.id, { status: 'queued' }, now());
			return { roundId, status: 'queued' };
		}
		setJob(db, job.id, { status: 'done' }, now());
		writePodiumCover(db, roundId);
		return { roundId, status: 'done' };
	} catch (e) {
		console.error(`[cover-auto] round ${roundId} job failed:`, e instanceof Error ? e.message : e);
		setJob(db, job.id, { status: 'failed' }, now());
		writePodiumCover(db, roundId);
		return { roundId, status: 'failed' };
	}
}

/** Park the job for approval and send exactly one budget ntfy for it. */
async function park(db: DB, job: CoverAutoJob, deps: TickDeps, now: number): Promise<{ roundId: number; status: JobStatus }> {
	const token = mintHilToken();
	setJob(db, job.id, { status: 'awaiting_approval', hil_token: token, notified_at: iso(now) }, now);
	const n = buildBudgetNotification(job.round_id, roundSpend(db, job.round_id), token, { bearer: process.env.NTFY_TOKEN });
	let sent = false;
	try {
		sent = await (deps.notify ?? ((x: Notification) => publishCoverAutoAlert(x)))(n);
	} catch (e) {
		console.error(`[cover-auto] round ${job.round_id}: budget ntfy failed:`, e instanceof Error ? e.message : e);
	}
	if (!sent) {
		// Nobody can approve without the ntfy: close the round now (operator run-now can retry).
		console.error(`[cover-auto] round ${job.round_id}: budget ntfy not delivered; remaining slots failed`);
		closeUnapproved(db, { ...job, status: 'awaiting_approval' }, now, NOTIFY_FAILED_NOTE);
		return { roundId: job.round_id, status: 'done' };
	}
	return { roundId: job.round_id, status: 'awaiting_approval' };
}

let timer: ReturnType<typeof setInterval> | null = null;

/** In-process poller on its own interval (COVER_AUTO_POLL_MS, default 60 s); never holds the event loop open. */
export function startCoverAutoRunner(): () => void {
	if (timer) return stopCoverAutoRunner;
	const ms = Number(process.env.COVER_AUTO_POLL_MS) > 0 ? Number(process.env.COVER_AUTO_POLL_MS) : 60_000;
	timer = setInterval(() => {
		void tickCoverAuto(getDb()).catch((e) => console.error('[cover-auto] tick failed:', e instanceof Error ? e.message : e));
	}, ms);
	timer.unref();
	return stopCoverAutoRunner;
}

export function stopCoverAutoRunner(): void {
	if (timer) clearInterval(timer);
	timer = null;
}

// ---------- operator UI (GET /api/cover-factory?autoLeagues=1 | ?autoRound=<id>, POST 'auto-leagues') ----------

export interface AutoLeagueRow { slug: string; name: string; on: boolean }
export interface AutoJobRow { round_id: number; status: JobStatus; updated_at: string; roundName: string | null; leagueSlug: string | null }
export interface AutoSlotRow extends PodiumSlot { project_title: string | null }

const ROUND_LEAGUE_SQL = `SELECT r.id, r.name, l.slug AS leagueSlug, l.name AS leagueName FROM rounds r
	JOIN seasons s ON s.id = r.season_id JOIN leagues l ON l.id = s.league_id WHERE r.id = ?`;

/** Every league with its auto-run toggle, plus the most recent auto jobs (newest first). */
export function autoLeaguesState(db: DB): { leagues: AutoLeagueRow[]; jobs: AutoJobRow[] } {
	const on = autoLeagues(db);
	const leagues = (db.prepare('SELECT slug, name FROM leagues ORDER BY name').all() as { slug: string; name: string }[])
		.map((l) => ({ ...l, on: on[l.slug] === true }));
	const jobs = db
		.prepare(
			`SELECT j.round_id, j.status, j.updated_at, r.name AS roundName, l.slug AS leagueSlug
			 FROM cover_auto_jobs j LEFT JOIN rounds r ON r.id = j.round_id
			 LEFT JOIN seasons s ON s.id = r.season_id LEFT JOIN leagues l ON l.id = s.league_id
			 ORDER BY j.updated_at DESC, j.id DESC LIMIT 20`,
		)
		.all() as AutoJobRow[];
	return { leagues, jobs };
}

/** One round's auto run: its league toggle, job, slots (with the linked project's title) and spend so far. */
export function autoRoundState(db: DB, roundId: number) {
	const r = db.prepare(ROUND_LEAGUE_SQL).get(roundId) as { id: number; name: string; leagueSlug: string; leagueName: string } | undefined;
	if (!r) throw new ApiError(404, 'round not found');
	const slots = db
		.prepare(
			`SELECT s.*, p.title AS project_title FROM cover_podium_slots s LEFT JOIN cover_projects p ON p.id = s.project_id
			 WHERE s.round_id = ? ORDER BY s.rank, s.id`,
		)
		.all(roundId) as AutoSlotRow[];
	return {
		round: { ...r, autoOn: autoLeagues(db)[r.leagueSlug] === true },
		job: getAutoJob(db, roundId) ?? null,
		slots,
		spendUsd: roundSpend(db, roundId),
	};
}

/** GET query handled here (not in service.getState); undefined when the query is not an auto one. */
export function getAutoState(db: DB, q: URLSearchParams): unknown {
	if (q.has('autoLeagues')) return autoLeaguesState(db);
	const raw = q.get('autoRound');
	if (raw == null) return undefined;
	const roundId = Number(raw);
	if (!Number.isInteger(roundId) || roundId <= 0) throw new ApiError(400, 'autoRound must be a round id');
	return autoRoundState(db, roundId);
}

/** POST actions handled here: 'run-auto' and 'auto-leagues'. undefined for any other action. */
export function runAutoUiAction(db: DB, b: Record<string, unknown>): unknown {
	if (b.action === 'run-auto') return runAutoAction(db, b);
	if (b.action !== 'auto-leagues') return undefined;
	const slug = typeof b.slug === 'string' ? b.slug : '';
	if (!slug || !db.prepare('SELECT 1 FROM leagues WHERE slug = ?').get(slug)) throw new ApiError(400, 'unknown league');
	if (typeof b.on !== 'boolean') throw new ApiError(400, 'on must be true or false');
	setAutoLeague(db, slug, b.on);
	return autoLeaguesState(db);
}
