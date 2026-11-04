import type Database from 'better-sqlite3';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';
import { generateFactoryImage, type FetchLike } from '../avatarFactory/generate.js';
import { resolveProvider } from '../avatarFactory/providers.js';
import { normalizeImage } from '../avatarFactory/normalize.js';
import { ProviderError } from '../avatarFactory/errors.js';
import { assertGenerationAllowed } from '../avatarFactory/pause.js';
import { normalizeBreakdown } from './breakdown.js';
import { getPinnedCoverModel } from './models.js';
import { coverFile } from './paths.js';
import { buildSwapPrompt, type Identity, type Treatment } from './prompt.js';
import { getProject, insertVersion, listVersions, logRequest, updateProject, type CoverVersion } from './repo.js';

export interface GenerateInput {
	projectId: number;
	treatments: Treatment[];
	identities: Identity[];
	/** slug -> image bytes */
	headshots: Record<string, Buffer>;
	modelId?: string;
	promptOverride?: string;
	fetchImpl?: FetchLike;
}

const GENERATE_TIMEOUT_MS = 180_000;

export async function generateVersion(db: Database.Database, input: GenerateInput): Promise<CoverVersion> {
	assertGenerationAllowed();
	const project = getProject(db, input.projectId);
	if (!project) throw new Error(`cover project ${input.projectId} not found`);
	const modelId = input.modelId ?? getPinnedCoverModel(db, 'generator');
	if (!modelId) throw new Error('no generator model pinned');

	const providerId = modelId.startsWith('fal-ai/') ? 'fal' : 'openrouter';
	const provider = { ...resolveProvider(providerId), defaultModel: modelId };

	const breakdown = normalizeBreakdown(project.breakdown_json ? JSON.parse(project.breakdown_json) : {});
	const built = buildSwapPrompt(breakdown, input.treatments, input.identities);
	const prompt = input.promptOverride ?? built.prompt;

	updateProject(db, project.id, { treatments_json: JSON.stringify(input.treatments) });

	const imageDataUrls: string[] = [];
	for (const key of built.imageOrder) {
		const bytes = key === 'cover' ? readFileSync(coverFile(project.cover_rel)) : input.headshots[key];
		if (!bytes) throw new Error(`missing headshot for ${key}`);
		imageDataUrls.push((await normalizeImage(bytes, `${key}.png`)).dataUrl);
	}

	const base = { project_id: project.id, model_id: modelId, provider: providerId, prompt };
	const t0 = Date.now();
	try {
		const res = await generateFactoryImage(provider, {
			prompt,
			imageDataUrls,
			aspectRatio: '1:1',
			fetchImpl: input.fetchImpl,
			timeoutMs: GENERATE_TIMEOUT_MS,
		});
		// No awaits from here to insertVersion: the try number guess below is exact in-process.
		const nextTry = Math.max(0, ...listVersions(db, project.id).map((v) => v.try_no)) + 1;
		const rel = `versions/${project.id}/${nextTry}-${randomBytes(3).toString('hex')}.png`;
		const abs = coverFile(rel);
		mkdirSync(dirname(abs), { recursive: true });
		writeFileSync(abs, res.bytes, { flag: 'wx' });
		const version = insertVersion(db, { ...base, image_rel: rel, status: 'ok', error_reason: null });
		logRequest(db, {
			project_id: project.id, version_id: version.id, step: 'generate', model_id: modelId,
			provider: providerId, latency_ms: res.latencyMs, cost_usd: res.costUsd,
			cost_estimated: res.costEstimated ? 1 : 0, outcome: 'ok', error_reason: null,
		});
		return version;
	} catch (e) {
		if (!(e instanceof ProviderError)) throw e;
		const version = insertVersion(db, { ...base, image_rel: null, status: 'failed', error_reason: e.reason });
		logRequest(db, {
			project_id: project.id, version_id: version.id, step: 'generate', model_id: modelId,
			provider: providerId, latency_ms: Date.now() - t0, cost_usd: e.failedCostUsd ?? null,
			cost_estimated: 0,
			outcome: e.reason === 'no_image' || e.reason === 'safety_refusal' ? 'no_image' : 'error',
			error_reason: e.reason,
		});
		return version;
	}
}
