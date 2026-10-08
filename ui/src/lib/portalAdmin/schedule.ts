// Portal admin — next-scheduled-run heuristic for the SectionCatalog's
// `nextDue` map. Pure so it stays unit-testable without a DB.
import type { Frequency } from './config.js';

const STEP_MS: Record<string, number> = {
	hourly: 36e5,
	daily: 864e5,
	weekly: 7 * 864e5,
};

export function nextDueAfter(
	frequency: Frequency,
	lastRunAt: string | null,
	now = Date.now()
): string | null {
	if (frequency === 'manual' || frequency === 'on-event') return null;
	if (!lastRunAt) return null;
	const step = STEP_MS[frequency];
	if (!step) return null;
	const last = Date.parse(lastRunAt);
	if (Number.isNaN(last)) return null;
	let next = last + step;
	while (next <= now) next += step;
	return new Date(next).toISOString();
}