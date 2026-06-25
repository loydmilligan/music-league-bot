import type { Accent } from './types.js';
import { icons } from './icons.js';

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

/* Semantic icon per accent — award cards pick this instead of a single trophy */
export const ACCENT_ICON: Record<Accent, string> = {
	amber: icons.trophy,   /* achievement / winner */
	moss:  icons.heart,    /* social / warmth / loved */
	sky:   icons.spark,    /* insight / analytical */
	ember: icons.bolt,     /* excitement / divisive / fire */
	pulp:  icons.crown,    /* standout / brand highlight */
};

export function accentIcon(name: string): string {
	return ACCENT_ICON[name as Accent] ?? icons.star;
}
