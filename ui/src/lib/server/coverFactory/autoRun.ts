import type Database from 'better-sqlite3';
import { ProviderError } from '../avatarFactory/errors.js';
import type { FetchLike } from '../avatarFactory/openrouter.js';
import { PAUSED_MESSAGE, assertGenerationAllowed } from '../avatarFactory/pause.js';
import { normalizeBreakdown } from './breakdown.js';
import { generateVersion } from './generate.js';
import { loadHeadshot } from './inputs.js';
import { applyConcept, pitchConcepts } from './pitch.js';
import { coverFile } from './paths.js';
import { writeKeeperGif, writePodiumCover, type PodiumSlot } from './podium.js';
import { defaultTreatments, type Treatment } from './prompt.js';
import { getProject, listVersions, updateProject, type CoverProject, type CoverVersion } from './repo.js';
import { createRoundProject, loadIdentities, playersFor, readProject, setKeeper, submitterFor, useAlternate } from './service.js';

type DB = Database.Database;

export const FAL_FALLBACK_MODEL = 'fal-ai/nano-banana/edit';
/** Never start a paid call once the round's spend would pass this, approved or not. */
export const HARD_CAP_USD = 2.0;
/** Pre-call estimate per paid step (generate: per attempt). */
export const STEP_ESTIMATE_USD = { read: 0.02, identity: 0.01, pitch: 0.07, generate: 0.1 } as const;
/** Generator attempt + 2 retries, before the one fal fallback. */
const PRIMARY_ATTEMPTS = 3;

export interface AutoDeps {
	fetchImpl?: FetchLike;
	/** Unused by runSlot (the job layer sends the budget ntfy); accepted so one deps bag serves both. */
	notify?: (n: unknown) => Promise<boolean>;
	now?: () => number;
}

/**
 * - done / failed: final for this slot.
 * - needs_approval: the next paid step would pass the $1.00 cap; slot is back to `pending` (its project
 *   kept) so the job can park for approval and re-run it with the $2.00 cap.
 * - paused: the generation pause gate is on; slot is back to `pending` for a later retry.
 * - skipped / running: the slot was not pending (refused untouched; returns its status).
 */
export type SlotOutcome = 'done' | 'failed' | 'skipped' | 'needs_approval' | 'paused' | 'running';

type Step = keyof typeof STEP_ESTIMATE_USD;

class Stop extends Error {
	constructor(readonly outcome: 'failed' | 'needs_approval', message: string) {
		super(message);
	}
}

/**
 * Spend on the round: cover_requests for projects linked to the round's slots. runSlot links a new
 * project to its slot right after creating it, so the project being worked on is always counted.
 * Strict: a row whose cost is unknown (NULL: timed-out / aborted call) or reported as 0 (fal logs 0
 * when it reports no cost) counts at its step estimate, so the budget gate never undercounts.
 */
export function roundSpend(db: DB, roundId: number): number {
	const r = db
		.prepare(
			`SELECT COALESCE(SUM(CASE WHEN cost_usd IS NULL OR cost_usd <= 0 THEN
			     CASE step WHEN 'read' THEN @read WHEN 'identity' THEN @identity WHEN 'pitch' THEN @pitch WHEN 'generate' THEN @generate ELSE 0 END
			   ELSE cost_usd END), 0) AS s
			 FROM cover_requests
			 WHERE project_id IN (SELECT project_id FROM cover_podium_slots WHERE round_id = @roundId AND project_id IS NOT NULL)`,
		)
		.get({ roundId, ...STEP_ESTIMATE_USD }) as { s: number };
	return Math.round(r.s * 1e6) / 1e6;
}

const isPaused = (e: unknown) => e instanceof Error && e.message === PAUSED_MESSAGE;

function reasonOf(e: unknown): string {
	if (e instanceof ProviderError) return e.reason;
	return (e instanceof Error ? e.message : String(e)).slice(0, 200);
}

const hasPlayer = (ts: Treatment[]) => ts.some((t) => t.mode === 'player' && t.playerSlug);

function parseTreatments(p: CoverProject): Treatment[] {
	try {
		const t = JSON.parse(p.treatments_json ?? '[]');
		return Array.isArray(t) ? (t as Treatment[]) : [];
	} catch {
		return [];
	}
}

/** A run whose slot has not been touched (claim / heartbeat) for this long is treated as crashed. */
export const STALE_RUN_MS = 15 * 60_000;

/**
 * Reset `running` slots (of one round, or all) whose updated_at is older than the threshold back to
 * `pending`, so a crashed run does not hold its slot forever. Live runs heartbeat at every paid step.
 */
export function reclaimStaleSlots(db: DB, roundId?: number, olderThanMs = STALE_RUN_MS, now = Date.now()): number {
	const cutoff = new Date(now - olderThanMs).toISOString();
	const stamp = new Date(now).toISOString();
	const sql = `UPDATE cover_podium_slots SET status = 'pending', note = 'reclaimed after interrupted run', updated_at = ?
		 WHERE status = 'running' AND updated_at < ?`;
	const r = roundId == null
		? db.prepare(sql).run(stamp, cutoff)
		: db.prepare(`${sql} AND round_id = ?`).run(stamp, cutoff, roundId);
	return r.changes;
}

/**
 * Make the automatic cover for one podium slot. Claims the slot (pending → running), creates or
 * reuses its project, reads the cover, plans the swap, generates with retries + fal fallback, sets
 * the keeper and pre-renders the private wipe GIF. Every paid step is budget-checked first.
 *
 * NOT safe to run concurrently for slots of the same round: the budget gate is check-then-spend
 * (roundSpend is read, then the paid call runs), so two runs could each pass the gate and together
 * overshoot the cap. The caller (Task 3's queue) must serialize slots per round.
 */
export async function runSlot(
	db: DB, roundId: number, slotId: number, budget: { capUsd: number }, deps: AutoDeps = {},
): Promise<SlotOutcome> {
	const now = deps.now ?? Date.now;
	const stamp = () => new Date(now()).toISOString();
	reclaimStaleSlots(db, roundId, STALE_RUN_MS, now());
	const claim = db
		.prepare(`UPDATE cover_podium_slots SET status = 'running', updated_at = ? WHERE id = ? AND round_id = ? AND status = 'pending'`)
		.run(stamp(), slotId, roundId);
	if (claim.changes === 0) {
		const row = db.prepare('SELECT status FROM cover_podium_slots WHERE id = ? AND round_id = ?').get(slotId, roundId) as
			| { status: PodiumSlot['status'] }
			| undefined;
		if (!row) throw new Error(`podium slot ${slotId} not found in round ${roundId}`);
		return row.status as SlotOutcome;
	}
	const set = (status: PodiumSlot['status'], note: string | null) =>
		db.prepare('UPDATE cover_podium_slots SET status = ?, note = ?, updated_at = ? WHERE id = ?').run(status, note, stamp(), slotId);

	try {
		await work(db, roundId, slotId, budget, deps, stamp);
		return 'done';
	} catch (e) {
		if (isPaused(e)) {
			set('pending', 'generation paused: will retry');
			return 'paused';
		}
		if (e instanceof Stop && e.outcome === 'needs_approval') {
			set('pending', e.message);
			return 'needs_approval';
		}
		set('failed', e instanceof Stop ? e.message : reasonOf(e));
		writePodiumCover(db, roundId); // refresh the operator note on the draft
		return 'failed';
	}
}

async function work(
	db: DB, roundId: number, slotId: number, budget: { capUsd: number }, deps: AutoDeps, stamp: () => string,
): Promise<void> {
	const fetchImpl = deps.fetchImpl;
	const cap = Math.min(budget.capUsd, HARD_CAP_USD);
	const gate = (step: Step) => {
		assertGenerationAllowed();
		const spend = roundSpend(db, roundId);
		if (spend >= HARD_CAP_USD || spend + STEP_ESTIMATE_USD[step] > cap + 1e-9) {
			if (spend >= HARD_CAP_USD || cap >= HARD_CAP_USD) throw new Stop('failed', 'budget cap reached');
			throw new Stop('needs_approval', 'waiting for budget approval');
		}
		// Heartbeat: a long run is not mistaken for a crashed one by reclaimStaleSlots.
		db.prepare('UPDATE cover_podium_slots SET updated_at = ? WHERE id = ?').run(stamp(), slotId);
	};

	assertGenerationAllowed(); // a pause leaves the slot pending before anything is created
	const slot = db.prepare('SELECT * FROM cover_podium_slots WHERE id = ?').get(slotId) as PodiumSlot;
	if (slot.submission_id == null) throw new Stop('failed', 'no matching submission');

	// 1. Project: reuse the slot's (a resumed run), else create from the round submission and link it now.
	let project = slot.project_id != null ? getProject(db, slot.project_id) : null;
	if (!project) {
		project = await createRoundProject(db, roundId, slot.submission_id, fetchImpl);
		db.prepare('UPDATE cover_podium_slots SET project_id = ?, updated_at = ? WHERE id = ?').run(project.id, stamp(), slotId);
	}
	const projectId = project.id;
	const fresh = () => getProject(db, projectId)!;

	// 2. The submitter goes in: no usable headshot → fail before spending anything.
	const submitter = submitterFor(db, project);
	if (!submitter) throw new Stop('failed', 'no submitter for this song');
	const player = playersFor(project).find((p) => p.slug === submitter.slug);
	if (!player || !(await loadHeadshot(projectId, player))) throw new Stop('failed', `no headshot for ${submitter.name}`);

	let keeper = keeperOf(db, project);
	let keptOperator = false;
	if (!keeper) {
		// 3. Read, then plan.
		if (!project.breakdown_json) {
			gate('read');
			await readProject(db, projectId, fetchImpl);
		}
		let treatments = parseTreatments(fresh());
		if (!hasPlayer(treatments)) treatments = await plan(db, fresh(), submitter, gate, fetchImpl);

		// 4. Identity + generate with retries, then the fal fallback.
		const { identities, headshots } = await loadIdentities(db, fresh(), treatments, {
			fetchImpl,
			beforeDescribe: () => gate('identity'),
		}).catch((e: unknown) => {
			const m = /missing headshot for (.+)$/.exec(e instanceof Error ? e.message : '');
			throw m ? new Stop('failed', `no headshot for ${m[1]}`) : e;
		});
		let lastError: string | null = null;
		const gen = async (modelId?: string): Promise<CoverVersion | null> => {
			gate('generate');
			try {
				const v = await generateVersion(db, { projectId, treatments, identities, headshots, modelId, fetchImpl });
				return v.status === 'ok' && v.image_rel ? v : null;
			} catch (e) {
				if (isPaused(e) || e instanceof Stop) throw e;
				lastError = reasonOf(e);
				return null;
			}
		};
		const tried = listVersions(db, projectId);
		for (let i = tried.filter((v) => v.provider !== 'fal').length; i < PRIMARY_ATTEMPTS && !keeper; i++) keeper = await gen();
		if (!keeper && process.env.FAL_KEY && !listVersions(db, projectId).some((v) => v.provider === 'fal')) {
			keeper = await gen(FAL_FALLBACK_MODEL);
			if (!keeper && lastError) lastError = `fal: ${lastError}`;
		}
		if (!keeper) {
			const lastFailed = listVersions(db, projectId).filter((v) => v.status === 'failed').at(-1);
			const reason = lastError ?? (lastFailed ? `${lastFailed.provider === 'fal' ? 'fal: ' : ''}${lastFailed.error_reason}` : 'no image');
			throw new Stop('failed', `generation failed: ${reason}`);
		}
		// The operator may have picked a keeper in the factory while this run was generating: theirs wins.
		const operatorKeeper = keeperOf(db, fresh());
		if (operatorKeeper && operatorKeeper.id !== keeper.id) {
			keeper = operatorKeeper;
			keptOperator = true;
		} else {
			// Slots linked to the project → done, draft re-applied; the GIF is pre-rendered just below.
			setKeeper(db, projectId, keeper.id, { prerender: false });
		}
	}

	// 5. Pre-render the private wipe GIF once (never overwrite) and point the draft at it.
	let gifRel: string | null = null;
	let note = keptOperator
		? 'operator keeper kept'
		: `auto: try ${keeper.try_no} via ${keeper.provider}${keeper.provider === 'fal' ? ' fallback' : ''}`;
	try {
		gifRel = await writeKeeperGif(keeper, fresh().cover_rel);
	} catch (e) {
		note += ` (GIF pre-render failed: ${reasonOf(e)})`;
	}
	db.prepare(`UPDATE cover_podium_slots SET status = 'done', gif_rel = ?, note = ?, updated_at = ? WHERE id = ?`).run(gifRel, note, stamp(), slotId);
	writePodiumCover(db, roundId);
}

function keeperOf(db: DB, project: CoverProject): CoverVersion | null {
	if (project.keeper_version_id == null) return null;
	const v = listVersions(db, project.id).find((x) => x.id === project.keeper_version_id);
	return v && v.status === 'ok' && v.image_rel ? v : null;
}

/**
 * Treatments for a cover whose default treatments put nobody in: main subject / ≥2 people are
 * handled by defaultTreatments; otherwise pitch (submitter only, 3 concepts) and apply the first
 * concept, or, when that concept is an alternate edition, switch to it and use its read's defaults.
 */
async function plan(
	db: DB, project: CoverProject, submitter: { slug: string; name: string },
	gate: (s: Step) => void, fetchImpl?: FetchLike,
): Promise<Treatment[]> {
	const breakdown = normalizeBreakdown(JSON.parse(project.breakdown_json!));
	const defaults = defaultTreatments(breakdown, submitter);
	if (hasPlayer(defaults)) {
		updateProject(db, project.id, { treatments_json: JSON.stringify(defaults) });
		return defaults;
	}
	gate('pitch');
	const concepts = await pitchConcepts(db, project.id, { playerSlugs: [submitter.slug], count: 3, fetchImpl }).catch((e: unknown) => {
		// pitchConcepts throws when the model's answer cleans down to nothing.
		if (e instanceof Error && e.message === 'no usable concepts') return [];
		throw e;
	});
	const first = concepts[0];
	if (!first) throw new Stop('failed', 'pitch returned no concepts');
	if (first.move === 'alternate') {
		await useAlternate(db, project.id, first.alternateId, fetchImpl);
		gate('read');
		const { treatments } = await readProject(db, project.id, fetchImpl);
		if (!hasPlayer(treatments)) throw new Stop('failed', 'no one to swap on the alternate cover');
		return treatments;
	}
	const out = applyConcept(breakdown, parseTreatments(project), first);
	updateProject(db, project.id, { breakdown_json: JSON.stringify(out.breakdown), treatments_json: JSON.stringify(out.treatments) });
	if (!hasPlayer(out.treatments)) throw new Stop('failed', 'pitched concept puts no player in');
	return out.treatments;
}
