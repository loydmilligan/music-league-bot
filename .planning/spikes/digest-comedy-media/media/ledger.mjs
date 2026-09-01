/**
 * ledger.mjs — every paid call this spike makes, appended to one file.
 *
 * OpenRouter's /credits gives account-wide lifetime spend, which includes
 * everything else on the key. This is the slice attributable to the comedy
 * spike, so the lab can show both.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LEDGER = path.join(path.dirname(fileURLToPath(import.meta.url)), '.cost-ledger.jsonl');

export function record(tool, model, cost, note = '') {
	if (!cost) return;
	fs.appendFileSync(LEDGER, JSON.stringify({
		ts: new Date().toISOString(), tool, model, cost: +cost, note: String(note).slice(0, 120),
	}) + '\n');
}

export function totals() {
	if (!fs.existsSync(LEDGER)) return { total: 0, n: 0, byTool: {} };
	const rows = fs.readFileSync(LEDGER, 'utf8').trim().split('\n')
		.filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
	const byTool = {};
	for (const r of rows) {
		byTool[r.tool] ??= { cost: 0, n: 0 };
		byTool[r.tool].cost += r.cost; byTool[r.tool].n++;
	}
	return { total: rows.reduce((a, r) => a + r.cost, 0), n: rows.length, byTool };
}
