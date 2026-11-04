import { resolve } from 'node:path';
import { resolveUnderRoot } from '../avatarFactory/paths.js';

export function coverRoot(): string {
	const dataDir = process.env.DATA_DIR ?? resolve(process.cwd(), '../data');
	return resolve(dataDir, 'cover-factory');
}

/** Path-guarded absolute path for a root-relative file. */
export function coverFile(rel: string): string {
	return resolveUnderRoot(coverRoot(), rel);
}
