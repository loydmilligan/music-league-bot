/**
 * Host-side copy of the video-playlist config contract.
 *
 * run.mjs executes on the host as plain ESM (see deploy/mlb-ytm-drop.service)
 * and cannot import ui/src/lib/db/videoPlaylist.ts, which is TypeScript and
 * only ever built inside the bot-ui image. So the contract lives twice.
 *
 * tests/videoPlaylistContract.test.ts imports BOTH and fails if they disagree
 * on any case, including malformed input. If you change one, change the other.
 * The prose explaining what these flags MEAN lives in the TypeScript copy.
 */

export const DEFAULT_VIDEO_PLAYLIST_CONFIG = {
	enabled: false,
	useComments: true,
	useSearch: true,
	searchAutoAcceptPct: 70,
	hilPct: 40,
};

export const VIDEO_PLAYLIST_DEFAULTS_KEY = 'video_playlist_defaults';

const asBool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);

function asPct(v, fallback) {
	const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
	if (!Number.isFinite(n)) return fallback;
	return Math.min(100, Math.max(0, Math.round(n)));
}

export function normalizeVideoPlaylistConfig(raw, base = DEFAULT_VIDEO_PLAYLIST_CONFIG) {
	const r = raw && typeof raw === 'object' ? raw : {};
	const searchAutoAcceptPct = asPct(r.searchAutoAcceptPct, base.searchAutoAcceptPct);
	return {
		enabled: asBool(r.enabled, base.enabled),
		useComments: asBool(r.useComments, base.useComments),
		useSearch: asBool(r.useSearch, base.useSearch),
		searchAutoAcceptPct,
		hilPct: Math.min(asPct(r.hilPct, base.hilPct), searchAutoAcceptPct),
	};
}

/** Which bucket a pick falls in. Mirrors bandForScore in the TypeScript twin. */
export function bandForScore(score, cfg, fromComment = false) {
	if (fromComment) return 'certain';
	if (score >= cfg.searchAutoAcceptPct) return 'auto';
	if (score >= cfg.hilPct) return 'review';
	return 'suggestion';
}

export function parseConfigJson(json) {
	if (!json || !String(json).trim()) return null;
	try {
		return JSON.parse(json);
	} catch {
		return null;
	}
}

export function resolveVideoPlaylistConfig(roundJson, defaultsJson) {
	const defaults = normalizeVideoPlaylistConfig(parseConfigJson(defaultsJson));
	const round = parseConfigJson(roundJson);
	return round == null ? defaults : normalizeVideoPlaylistConfig(round, defaults);
}

export function hasNoVideoSource(cfg) {
	return cfg.enabled && !cfg.useComments && !cfg.useSearch;
}

/** Read the effective config for a round straight out of league.db. */
export function readRoundVideoConfig(db, roundId) {
	const round = db.prepare('SELECT video_playlist_config AS c FROM rounds WHERE id = ?').get(roundId);
	const defaults = db.prepare('SELECT value FROM settings WHERE key = ?').get(VIDEO_PLAYLIST_DEFAULTS_KEY);
	return resolveVideoPlaylistConfig(round?.c ?? null, defaults?.value ?? null);
}
