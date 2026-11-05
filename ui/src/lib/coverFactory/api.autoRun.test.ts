import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { RERUN_PROMPT, needsRerunConfirm } from './api';

describe('Run auto now: re-run confirmation', () => {
	it('only a done job asks first', () => {
		expect(needsRerunConfirm({ status: 'done' })).toBe(true);
		for (const status of ['queued', 'running', 'awaiting_approval', 'failed'] as const) expect(needsRerunConfirm({ status })).toBe(false);
		expect(needsRerunConfirm(null)).toBe(false);
		expect(RERUN_PROMPT).toBe('Run again? This can spend up to $1 more and may ask for approval.');
	});
	it('the panel confirms before posting run-auto', () => {
		const src = readFileSync('src/lib/coverFactory/AutoRoundPanel.svelte', 'utf8');
		const fn = src.slice(src.indexOf('async function runNow'), src.indexOf("cfPost({ action: 'run-auto'"));
		expect(fn).toContain('if (needsRerunConfirm(st?.job) && !confirm(RERUN_PROMPT)) return;');
	});
});
