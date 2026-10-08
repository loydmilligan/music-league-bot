// Portal admin — plan view grouping (spec §9 GET /plan). Pure: takes the
// stored planner tasks and buckets them into the PlanView the b-side renders,
// so the bucketing rules are unit-testable without a DB.
import type { PlannerTask } from './taskStore.js';

export interface PlanTaskDto {
	key: string;
	round: number | null;
	kind: 'content' | 'ops' | 'review';
	label: string;
	notes: string | null;
	dueAt: string | null;
	source?: 'derived' | 'custom';
	status: 'open' | 'done' | 'skipped';
}

export interface PlanGroupDto {
	date: string | null;
	label: string;
	tasks: PlanTaskDto[];
}

export interface PlanViewDto {
	today: number;
	overdue: number;
	groups: PlanGroupDto[];
}

function toDto(t: PlannerTask): PlanTaskDto {
	return {
		key: t.key,
		round: t.roundNumber,
		kind: t.kind,
		label: t.title,
		notes: t.notes,
		dueAt: t.dueAt,
		source: t.source,
		status: t.status,
	};
}

export function groupPlanTasks(tasks: PlannerTask[], days: number, now = new Date()): PlanViewDto {
	const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
	const endOfToday = new Date(startOfToday.getTime() + 864e5);
	const horizon = new Date(startOfToday.getTime() + (days + 1) * 864e5);

	const open = tasks.filter((t) => t.status === 'open');
	let overdue = 0;
	let today = 0;
	const future = new Map<string, PlanGroupDto>();
	let someday: PlanTaskDto[] = [];

	for (const t of tasks) {
		const dto = toDto(t);
		if (t.dueAt === null) {
			if (t.status === 'open') someday.push(dto);
			continue;
		}
		const due = new Date(t.dueAt);
		if (due < endOfToday) {
			if (due < startOfToday) {
				if (t.status === 'open') overdue++;
				continue; // past-due tasks live in the first group bucket below
			}
			if (t.status === 'open') today++;
			continue; // today's tasks live in their own bucket below
		}
		if (due >= horizon) continue;
		const date = t.dueAt.slice(0, 10);
		const group = future.get(date) ?? { date, label: date, tasks: [] };
		group.tasks.push(dto);
		future.set(date, group);
	}

	const groups: PlanGroupDto[] = [];
	const pastDue = tasks
		.filter((t) => t.dueAt !== null && new Date(t.dueAt) < startOfToday)
		.sort((a, b) => (a.dueAt! < b.dueAt! ? -1 : 1))
		.map(toDto);
	if (pastDue.length) groups.push({ date: null, label: 'Past due', tasks: pastDue });

	const todays = tasks
		.filter((t) => t.dueAt !== null && new Date(t.dueAt) >= startOfToday && new Date(t.dueAt) < endOfToday)
		.sort((a, b) => (a.dueAt! < b.dueAt! ? -1 : 1))
		.map(toDto);
	if (todays.length) groups.push({ date: startOfToday.toISOString().slice(0, 10), label: 'Today', tasks: todays });

	for (const date of [...future.keys()].sort()) {
		const g = future.get(date)!;
		g.tasks.sort((a, b) => (a.dueAt! < b.dueAt! ? -1 : 1));
		groups.push(g);
	}

	if (someday.length) {
		someday.sort((a, b) => (a.label < b.label ? -1 : 1));
		groups.push({ date: null, label: 'Someday', tasks: someday });
	}

	return { today, overdue, groups };
}