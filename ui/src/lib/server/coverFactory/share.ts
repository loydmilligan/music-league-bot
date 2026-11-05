import type Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { digestBaseUrl } from '$lib/config/urls.js';
import { coverFile } from './paths.js';
import { getProject, listVersions, updateProject } from './repo.js';
import { makeStill, makeWipeGif } from './wipe.js';

export interface ShareUrls {
	stillUrl: string;
	gifUrl: string;
}

const STILL = 'cover.jpg';
const GIF = 'wipe.gif';

function urls(dir: string): ShareUrls {
	const base = `${digestBaseUrl()}/_media/covers/${dir}`;
	return { stillUrl: `${base}/${STILL}`, gifUrl: `${base}/${GIF}` };
}

/**
 * Publish the keeper as an unguessable static still + wipe GIF. Idempotent while the keeper is
 * unchanged; a new keeper always gets a new random directory (files never overwrite).
 */
export async function shareKeeper(
	db: Database.Database,
	projectId: number,
	digestsRoot: string = process.env.DIGESTS_DIR ?? '/app/digests',
): Promise<ShareUrls> {
	const project = getProject(db, projectId);
	if (!project) throw new Error(`cover project ${projectId} not found`);
	if (project.keeper_version_id == null) throw new Error('no keeper selected');
	const keeper = listVersions(db, projectId).find((v) => v.id === project.keeper_version_id);
	if (!keeper || keeper.status !== 'ok' || !keeper.image_rel) throw new Error('keeper has no image');

	const coversDir = join(digestsRoot, '_media', 'covers');
	if (
		project.share_dir &&
		project.share_version_id === project.keeper_version_id &&
		existsSync(join(coversDir, project.share_dir, STILL)) &&
		existsSync(join(coversDir, project.share_dir, GIF))
	) {
		return urls(project.share_dir);
	}

	const original = readFileSync(coverFile(keeper.cover_rel ?? project.cover_rel));
	const swapped = readFileSync(coverFile(keeper.image_rel));
	const [still, gif] = await Promise.all([makeStill(swapped), makeWipeGif(original, swapped)]);
	const dir = randomBytes(12).toString('hex');
	const abs = join(coversDir, dir);
	mkdirSync(abs, { recursive: true });
	writeFileSync(join(abs, STILL), still, { flag: 'wx' });
	writeFileSync(join(abs, GIF), gif, { flag: 'wx' });
	updateProject(db, projectId, { share_dir: dir, share_version_id: keeper.id });
	return urls(dir);
}
