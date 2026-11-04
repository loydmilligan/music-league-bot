import type Database from 'better-sqlite3';

export type CoverSource = 'round' | 'spotify' | 'upload';

export interface CoverProject {
	id: number;
	title: string;
	source: CoverSource;
	round_id: number | null;
	spotify_uri: string | null;
	league_slug: string | null;
	cover_rel: string;
	cover_url: string | null;
	breakdown_json: string | null;
	identities_json: string | null;
	treatments_json: string | null;
	keeper_version_id: number | null;
	share_dir: string | null;
	share_version_id: number | null;
	created_at: string;
	updated_at: string;
}

export interface CoverVersion {
	id: number;
	project_id: number;
	try_no: number;
	model_id: string;
	provider: string;
	prompt: string;
	image_rel: string | null;
	status: 'ok' | 'failed';
	error_reason: string | null;
	rating_likeness: number | null;
	rating_seamlessness: number | null;
	rating_gag: number | null;
	rating_instructions: number | null;
	note: string | null;
	created_at: string;
}

export interface CoverRequest {
	id: number;
	project_id: number;
	version_id: number | null;
	step: 'read' | 'identity' | 'generate';
	model_id: string;
	provider: string;
	latency_ms: number;
	cost_usd: number | null;
	cost_estimated: number;
	outcome: 'ok' | 'no_image' | 'error';
	error_reason: string | null;
	created_at: string;
}

type DB = Database.Database;

export function createProject(
	db: DB,
	p: Omit<
		CoverProject,
		| 'id'
		| 'created_at'
		| 'updated_at'
		| 'keeper_version_id'
		| 'share_dir'
		| 'share_version_id'
		| 'breakdown_json'
		| 'identities_json'
		| 'treatments_json'
	>
): CoverProject {
	const r = db
		.prepare(
			`INSERT INTO cover_projects (title, source, round_id, spotify_uri, league_slug, cover_rel, cover_url)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
		)
		.run(p.title, p.source, p.round_id, p.spotify_uri, p.league_slug, p.cover_rel, p.cover_url);
	return getProject(db, Number(r.lastInsertRowid))!;
}

export function getProject(db: DB, id: number): CoverProject | null {
	return (
		(db.prepare('SELECT * FROM cover_projects WHERE id = ?').get(id) as CoverProject | undefined) ??
		null
	);
}

export function listProjects(
	db: DB,
	limit = 50
): (CoverProject & { version_count: number; keeper_rel: string | null })[] {
	return db
		.prepare(
			`SELECT p.*,
			   (SELECT COUNT(*) FROM cover_versions v WHERE v.project_id = p.id) AS version_count,
			   (SELECT k.image_rel FROM cover_versions k WHERE k.id = p.keeper_version_id) AS keeper_rel
			 FROM cover_projects p ORDER BY p.id DESC LIMIT ?`
		)
		.all(limit) as (CoverProject & { version_count: number; keeper_rel: string | null })[];
}

const PATCHABLE = [
	'title',
	'breakdown_json',
	'identities_json',
	'treatments_json',
	'keeper_version_id',
	'share_dir',
	'share_version_id'
] as const;

export function updateProject(
	db: DB,
	id: number,
	patch: Partial<Pick<CoverProject, (typeof PATCHABLE)[number]>>
): CoverProject {
	const keys = PATCHABLE.filter((k) => k in patch);
	if (keys.length) {
		const sets = keys.map((k) => `${k} = ?`).join(', ');
		const vals = keys.map((k) => patch[k] ?? null);
		db.prepare(`UPDATE cover_projects SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(
			...vals,
			id
		);
	}
	const row = getProject(db, id);
	if (!row) throw new Error(`cover project ${id} not found`);
	return row;
}

export function insertVersion(
	db: DB,
	v: Omit<
		CoverVersion,
		| 'id'
		| 'try_no'
		| 'created_at'
		| 'rating_likeness'
		| 'rating_seamlessness'
		| 'rating_gag'
		| 'rating_instructions'
		| 'note'
	>
): CoverVersion {
	const tx = db.transaction(() => {
		const max = db
			.prepare('SELECT COALESCE(MAX(try_no), 0) AS m FROM cover_versions WHERE project_id = ?')
			.get(v.project_id) as { m: number };
		const r = db
			.prepare(
				`INSERT INTO cover_versions (project_id, try_no, model_id, provider, prompt, image_rel, status, error_reason)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(v.project_id, max.m + 1, v.model_id, v.provider, v.prompt, v.image_rel, v.status, v.error_reason);
		return Number(r.lastInsertRowid);
	});
	return getVersion(db, tx())!;
}

function getVersion(db: DB, id: number): CoverVersion | null {
	return (
		(db.prepare('SELECT * FROM cover_versions WHERE id = ?').get(id) as CoverVersion | undefined) ??
		null
	);
}

export function listVersions(db: DB, projectId: number): CoverVersion[] {
	return db
		.prepare('SELECT * FROM cover_versions WHERE project_id = ? ORDER BY try_no ASC')
		.all(projectId) as CoverVersion[];
}

const RATING_KEYS = ['likeness', 'seamlessness', 'gag', 'instructions'] as const;

export function rateVersion(
	db: DB,
	id: number,
	r: Partial<Record<(typeof RATING_KEYS)[number], number | null>>,
	note?: string | null
): CoverVersion {
	for (const k of RATING_KEYS) {
		const val = r[k];
		if (val === undefined || val === null) continue;
		if (!Number.isInteger(val) || val < 1 || val > 5) {
			throw new Error(`rating ${k} must be an integer 1-5 or null`);
		}
	}
	const sets: string[] = [];
	const vals: (number | string | null)[] = [];
	for (const k of RATING_KEYS) {
		if (k in r) {
			sets.push(`rating_${k} = ?`);
			vals.push(r[k] ?? null);
		}
	}
	if (note !== undefined) {
		sets.push('note = ?');
		vals.push(note);
	}
	if (sets.length) {
		db.prepare(`UPDATE cover_versions SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
	}
	const row = getVersion(db, id);
	if (!row) throw new Error(`cover version ${id} not found`);
	return row;
}

export function logRequest(db: DB, r: Omit<CoverRequest, 'id' | 'created_at'>): CoverRequest {
	const res = db
		.prepare(
			`INSERT INTO cover_requests (project_id, version_id, step, model_id, provider, latency_ms, cost_usd, cost_estimated, outcome, error_reason)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			r.project_id,
			r.version_id,
			r.step,
			r.model_id,
			r.provider,
			r.latency_ms,
			r.cost_usd,
			r.cost_estimated,
			r.outcome,
			r.error_reason
		);
	return db
		.prepare('SELECT * FROM cover_requests WHERE id = ?')
		.get(Number(res.lastInsertRowid)) as CoverRequest;
}

export function projectStats(
	db: DB,
	projectId: number
): { tries: number; failures: number; triesToKeeper: number | null; spendUsd: number } {
	const v = db
		.prepare(
			`SELECT COUNT(*) AS tries, COALESCE(SUM(status = 'failed'), 0) AS failures
			 FROM cover_versions WHERE project_id = ?`
		)
		.get(projectId) as { tries: number; failures: number };
	const keeper = db
		.prepare(
			`SELECT k.try_no FROM cover_projects p JOIN cover_versions k ON k.id = p.keeper_version_id WHERE p.id = ?`
		)
		.get(projectId) as { try_no: number } | undefined;
	const spend = db
		.prepare('SELECT COALESCE(SUM(cost_usd), 0) AS s FROM cover_requests WHERE project_id = ?')
		.get(projectId) as { s: number };
	return {
		tries: v.tries,
		failures: v.failures,
		triesToKeeper: keeper?.try_no ?? null,
		spendUsd: Math.round(spend.s * 1e6) / 1e6
	};
}
