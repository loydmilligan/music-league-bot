// Shared between the boarz-stats server data layer and client components —
// must NOT live under lib/server (client imports would be blocked).

export const AXIS_KEYS = ['energy', 'warmth', 'engagement', 'momentum'] as const;
export type AxisKey = (typeof AXIS_KEYS)[number];
export const AXIS_META: Record<AxisKey, { label: string; low: string; high: string }> = {
	energy: { label: 'Energy', low: 'flat', high: 'hype' },
	warmth: { label: 'Warmth', low: 'spicy', high: 'warm' },
	engagement: { label: 'Engagement', low: 'ignored', high: 'lights up' },
	momentum: { label: 'Momentum', low: 'kills it', high: 'keeps it going' },
};

export interface DaySummary {
	day: string;
	count: number;
	topics: string[];
	generatedAt: string;
}
