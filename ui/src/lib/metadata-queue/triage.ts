/**
 * triage.ts — groups failures into structured FailureGroup[] for display.
 *
 * groupFailures supports three grouping modes:
 *   'reason' — classify each error via classifyFailure and bucket by reason
 *   'job'    — bucket by job_type
 *   'round'  — bucket by representative round_id; null round_id → "unattributed"
 */

import { classifyFailure } from './failureReason.js';
import type { QueueFailure } from '$lib/db/metadataQueue.js';

export type GroupBy = 'reason' | 'job' | 'round';

export interface FailureGroup {
	key: string;
	label: string;
	glyph: string;
	tone: 'amber' | 'ember' | 'sky' | 'muted';
	why: string;
	ids: number[];
	count: number;
}

// ---------------------------------------------------------------------------
// Reason metadata
// ---------------------------------------------------------------------------

const REASON_META: Record<string, { label: string; glyph: string; tone: FailureGroup['tone']; why: string }> = {
	rate_limited: {
		label: 'Rate limited',
		glyph: '⏱',
		tone: 'amber',
		why: 'Last.fm/provider rate limit — wait and retry',
	},
	no_data: {
		label: 'No data',
		glyph: '∅',
		tone: 'muted',
		why: 'provider has no data for this track',
	},
	transient: {
		label: 'Transient error',
		glyph: '~',
		tone: 'sky',
		why: 'temporary network/5xx error',
	},
	config: {
		label: 'Config error',
		glyph: '!',
		tone: 'ember',
		why: 'API key not set/configured',
	},
};

// ---------------------------------------------------------------------------
// groupFailures
// ---------------------------------------------------------------------------

/**
 * Groups a list of QueueFailure records into FailureGroup[] by the given mode.
 *
 * @param failures  — the failures to group
 * @param by        — grouping dimension: 'reason' | 'job' | 'round'
 * @param roundNameById — optional map from round_id → name (unused; round_name
 *                        is now on QueueFailure directly)
 */
export function groupFailures(
	failures: QueueFailure[],
	by: GroupBy,
	_roundNameById?: Map<number, string>
): FailureGroup[] {
	if (failures.length === 0) return [];

	if (by === 'reason') {
		return groupByReason(failures);
	}
	if (by === 'job') {
		return groupByJob(failures);
	}
	// by === 'round'
	return groupByRound(failures);
}

// ---------------------------------------------------------------------------
// Grouping implementations
// ---------------------------------------------------------------------------

function groupByReason(failures: QueueFailure[]): FailureGroup[] {
	const buckets = new Map<string, number[]>();
	for (const f of failures) {
		const reason = classifyFailure(f.error);
		if (!buckets.has(reason)) buckets.set(reason, []);
		buckets.get(reason)!.push(f.id);
	}

	const groups: FailureGroup[] = [];
	for (const [reason, ids] of buckets) {
		const meta = REASON_META[reason] ?? REASON_META['transient'];
		groups.push({
			key: reason,
			label: meta.label,
			glyph: meta.glyph,
			tone: meta.tone,
			why: meta.why,
			ids,
			count: ids.length,
		});
	}
	return groups;
}

function groupByJob(failures: QueueFailure[]): FailureGroup[] {
	const buckets = new Map<string, number[]>();
	for (const f of failures) {
		if (!buckets.has(f.job_type)) buckets.set(f.job_type, []);
		buckets.get(f.job_type)!.push(f.id);
	}

	const groups: FailureGroup[] = [];
	for (const [job_type, ids] of buckets) {
		groups.push({
			key: job_type,
			label: job_type,
			glyph: '⚙',
			tone: 'muted',
			why: `${ids.length} failed ${job_type} job${ids.length !== 1 ? 's' : ''}`,
			ids,
			count: ids.length,
		});
	}
	return groups;
}

function groupByRound(failures: QueueFailure[]): FailureGroup[] {
	const buckets = new Map<string, { ids: number[]; label: string }>();
	for (const f of failures) {
		if (f.round_id == null) {
			if (!buckets.has('unattributed')) {
				buckets.set('unattributed', { ids: [], label: 'Unattributed' });
			}
			buckets.get('unattributed')!.ids.push(f.id);
		} else {
			const key = `round:${f.round_id}`;
			if (!buckets.has(key)) {
				buckets.set(key, { ids: [], label: f.round_name ?? `Round ${f.round_id}` });
			}
			buckets.get(key)!.ids.push(f.id);
		}
	}

	const groups: FailureGroup[] = [];
	for (const [key, { ids, label }] of buckets) {
		groups.push({
			key,
			label,
			glyph: '◎',
			tone: 'sky',
			why: `${ids.length} failed job${ids.length !== 1 ? 's' : ''} in this round`,
			ids,
			count: ids.length,
		});
	}
	return groups;
}
