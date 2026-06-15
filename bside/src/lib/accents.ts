import type { Accent } from './types.js';

export const BS_ACCENTS: Record<Accent, string> = {
	pulp:  'bs-acc-pulp',
	amber: 'bs-acc-amber',
	sky:   'bs-acc-sky',
	moss:  'bs-acc-moss',
	ember: 'bs-acc-ember',
};

export function bsAcc(name: string): string {
	return BS_ACCENTS[name as Accent] ?? 'bs-acc-pulp';
}
