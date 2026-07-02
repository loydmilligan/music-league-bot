import { z } from 'zod';

// Shared Zod schema for the taste-settings POST body. Lives in a plain module
// (not +server.ts) because SvelteKit rejects non-handler exports from route
// files at runtime — importing it here keeps both the route and its test valid.
export const TasteSettingsSchema = z.object({
	signal: z.enum(['all', 'subs', 'top', 'frac']),
	votePct: z.number().min(0).max(25),
	negatives: z.boolean(),
	dnPct: z.number().min(0).max(150),
	lyrWeight: z.number().min(0).max(1),
	spread: z.number().min(1).max(1.6),
	scopeAll: z.boolean(),
	showLabels: z.boolean(),
	showKey: z.boolean(),
	showRead: z.boolean(),
	showChips: z.boolean(),
	showLeagueAvg: z.boolean(),
	palette: z.enum(['neon', 'cool', 'spectrum']),
	lineStyle: z.enum(['strand', 'solid', 'none']),
	nodeStyle: z.enum(['glow', 'dot', 'none']),
	order: z.enum(['alt', 'raw', 'lyric-last', 'lyric-first']),
	band: z.boolean(),
	bandOpacity: z.number().min(0).max(0.3),
	amplitude: z.number().min(0.6).max(2.2),
});
