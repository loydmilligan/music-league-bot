import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

export class PathGuardError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PathGuardError';
	}
}

/** Resolve `userPath` under `root`. Rejects absolute paths, NUL, and `..`. */
export function resolveUnderRoot(root: string, userPath: string): string {
	if (typeof userPath !== 'string' || userPath.length === 0) {
		throw new PathGuardError('empty path');
	}
	if (userPath.includes('\0')) {
		throw new PathGuardError('invalid path');
	}
	const normalized = userPath.replace(/\\/g, '/');
	if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
		throw new PathGuardError('absolute path rejected');
	}
	const parts = normalized.split('/').filter((p) => p !== '' && p !== '.');
	if (parts.some((p) => p === '..')) {
		throw new PathGuardError('path traversal rejected');
	}
	const rootAbs = resolve(root);
	const resolved = resolve(rootAbs, parts.join('/'));
	if (resolved !== rootAbs && !resolved.startsWith(rootAbs + sep)) {
		throw new PathGuardError('path traversal rejected');
	}
	return resolved;
}

export function isInsideRoot(root: string, candidate: string): boolean {
	const rootAbs = resolve(root);
	const candAbs = resolve(candidate);
	return candAbs === rootAbs || candAbs.startsWith(rootAbs + sep);
}

export function sourcesRoot(): string {
	if (process.env.AVATAR_SOURCES_DIR) return resolve(process.env.AVATAR_SOURCES_DIR);
	const docker = '/app/avatar-sources';
	if (existsSync(docker)) return docker;
	const pictures = resolve(process.env.HOME ?? '', 'Pictures');
	if (existsSync(join(pictures, 'boarz-players'))) return pictures;
	return docker;
}

export function factoryRoot(): string {
	const dataDir = process.env.DATA_DIR ?? resolve(process.cwd(), '../data');
	return resolve(dataDir, 'avatar-factory');
}

export type SourceEntry = { name: string; rel: string; type: 'file' | 'dir'; size: number };

export function listSources(root: string, relDir = ''): SourceEntry[] {
	const dir = relDir ? resolveUnderRoot(root, relDir) : resolve(root);
	if (!existsSync(dir) || !statSync(dir).isDirectory()) {
		throw new PathGuardError('not a directory');
	}
	const entries = readdirSync(dir, { withFileTypes: true });
	const out: SourceEntry[] = [];
	for (const e of entries) {
		if (e.name.startsWith('.')) continue;
		const rel = relDir ? `${relDir.replace(/\/+$/, '')}/${e.name}` : e.name;
		const full = resolveUnderRoot(root, rel);
		const st = statSync(full);
		if (e.isDirectory()) out.push({ name: e.name, rel, type: 'dir', size: 0 });
		else if (e.isFile()) out.push({ name: e.name, rel, type: 'file', size: st.size });
	}
	out.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
	return out;
}

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

export function isImageName(name: string): boolean {
	const i = name.lastIndexOf('.');
	if (i < 0) return false;
	return IMAGE_EXT.has(name.slice(i).toLowerCase());
}
