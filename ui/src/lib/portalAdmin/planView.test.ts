import { describe, expect, it } from 'vitest';
import { groupPlanTasks } from './planView.js';
import type { PlannerTask } from './taskStore.js';

const now = new Date('2026-10-08T12:00:00Z');

function task(partial: Partial<PlannerTask> & { key: string }): PlannerTask {
	return {
		id: 1,
		leagueId: 1,
		seasonNumber: 2,
		roundNumber: null,
		title: 'Task',
		detail: null,
		dueAt: null,
		kind: 'ops',
		source: 'derived',
		status: 'open',
		completedAt: null,
		notes: null,
		...partial,
	};
}

describe('groupPlanTasks', () => {
	it('buckets past-due, today, future, and someday in order', () => {
		const tasks = [
			task({ key: 'past', dueAt: '2026-10-07T09:00:00Z' }),
			task({ key: 'today-a', dueAt: '2026-10-08T09:00:00Z' }),
			task({ key: 'future', dueAt: '2026-10-10T09:00:00Z' }),
			task({ key: 'someday', dueAt: null }),
		];
		const view = groupPlanTasks(tasks, 7, now);
		expect(view.overdue).toBe(1);
		expect(view.today).toBe(1);
		expect(view.groups.map((g) => g.label)).toEqual(['Past due', 'Today', '2026-10-10', 'Someday']);
		expect(view.groups[0].date).toBeNull();
		expect(view.groups[1].date).toBe('2026-10-08');
		expect(view.groups[1].tasks.map((t) => t.key)).toEqual(['today-a']);
		expect(view.groups[2].tasks.map((t) => t.key)).toEqual(['future']);
	});

	it('excludes done/skipped rows from the counts but keeps them in their group', () => {
		const tasks = [
			task({ key: 'done-today', status: 'done', dueAt: '2026-10-08T09:00:00Z' }),
			task({ key: 'open-today', dueAt: '2026-10-08T10:00:00Z' }),
			task({ key: 'skipped-past', status: 'skipped', dueAt: '2026-10-01T09:00:00Z' }),
		];
		const view = groupPlanTasks(tasks, 7, now);
		expect(view.today).toBe(1);
		expect(view.overdue).toBe(0);
		const todays = view.groups.find((g) => g.label === 'Today')!.tasks.map((t) => t.key);
		expect(todays).toEqual(['done-today', 'open-today']);
		const past = view.groups.find((g) => g.label === 'Past due')!.tasks.map((t) => t.key);
		expect(past).toEqual(['skipped-past']);
	});

	it('drops groups beyond the days horizon', () => {
		const tasks = [task({ key: 'soon', dueAt: '2026-10-09T09:00:00Z' }), task({ key: 'far', dueAt: '2026-10-30T09:00:00Z' })];
		const view = groupPlanTasks(tasks, 1, now);
		expect(view.groups.map((g) => g.label)).toEqual(['2026-10-09']);
	});

	it('handles an empty input', () => {
		expect(groupPlanTasks([], 7, now)).toEqual({ today: 0, overdue: 0, groups: [] });
	});
});