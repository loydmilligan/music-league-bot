import sharp from 'sharp';
import type Database from 'better-sqlite3';
import type { FetchLike } from '../avatarFactory/openrouter.js';
import { ProviderError } from '../avatarFactory/errors.js';
import { getPinnedCoverModel } from './models.js';
import { logRequest } from './repo.js';
import { chatWithImages } from './chat.js';
import { IDENTITY_PROMPT, READ_PROMPT, normalizeBreakdown, parseModelJson, type Breakdown } from './breakdown.js';

const TIMEOUT_MS = 120_000;

async function run<T>(
	db: Database.Database,
	projectId: number,
	step: 'read' | 'identity',
	prompt: string,
	dataUrl: string,
	o: { fetchImpl?: FetchLike } | undefined,
	parse: (text: string) => T,
): Promise<T> {
	const model = getPinnedCoverModel(db, 'reader');
	if (!model) throw new Error('No reader model available: pin or add a vision model for the cover reader');
	const base = { project_id: projectId, version_id: null, step, model_id: model, provider: 'openrouter', cost_estimated: 0 };
	const t0 = Date.now();
	let r;
	try {
		r = await chatWithImages({ model, prompt, imageDataUrls: [dataUrl], fetchImpl: o?.fetchImpl, timeoutMs: TIMEOUT_MS });
	} catch (e) {
		logRequest(db, {
			...base, latency_ms: Date.now() - t0,
			cost_usd: e instanceof ProviderError ? (e.failedCostUsd ?? null) : null,
			outcome: 'error',
			error_reason: e instanceof ProviderError ? e.reason : e instanceof Error ? e.message.slice(0, 200) : 'error',
		});
		throw e;
	}
	try {
		const out = parse(r.text);
		logRequest(db, { ...base, latency_ms: r.latencyMs, cost_usd: r.costUsd, outcome: 'ok', error_reason: null });
		return out;
	} catch (e) {
		logRequest(db, {
			...base, latency_ms: r.latencyMs, cost_usd: r.costUsd, outcome: 'error',
			error_reason: e instanceof Error ? e.message.slice(0, 200) : 'error',
		});
		throw e;
	}
}

async function dataUrlSize(dataUrl: string): Promise<{ width: number; height: number } | undefined> {
	try {
		const m = /^data:[^;,]*(;base64)?,(.*)$/s.exec(dataUrl);
		if (!m) return undefined;
		const bytes = m[1] ? Buffer.from(m[2], 'base64') : Buffer.from(decodeURIComponent(m[2]));
		const meta = await sharp(bytes).metadata();
		return meta.width && meta.height ? { width: meta.width, height: meta.height } : undefined;
	} catch {
		return undefined;
	}
}

export async function readCover(
	db: Database.Database, projectId: number, coverDataUrl: string,
	o?: { fetchImpl?: FetchLike; size?: { width: number; height: number } },
): Promise<Breakdown> {
	const size = o?.size ?? (await dataUrlSize(coverDataUrl));
	return run(db, projectId, 'read', READ_PROMPT, coverDataUrl, o, (t) => normalizeBreakdown(parseModelJson(t), size));
}

export function describeIdentity(
	db: Database.Database, projectId: number, headshotDataUrl: string, o?: { fetchImpl?: FetchLike },
): Promise<string> {
	return run(db, projectId, 'identity', IDENTITY_PROMPT, headshotDataUrl, o, (t) => {
		const s = t.trim();
		if (!s) throw new Error('empty identity description');
		return s;
	});
}
