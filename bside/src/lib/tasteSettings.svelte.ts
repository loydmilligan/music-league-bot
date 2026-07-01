/**
 * tasteSettings — the player-exposed Taste Waveform controls.
 * Persisted per-browser in localStorage; NEVER written to read_model.json.
 * Everything visual is locked in the engine; these are the signal/shape knobs.
 */
import { DEFAULT_TASTE_SETTINGS, type TasteSettings } from './taste-waveform/taste-waveform.js';

const KEY = 'bside:taste-settings';

function load(): TasteSettings {
	try {
		if (typeof localStorage !== 'undefined') {
			const raw = localStorage.getItem(KEY);
			if (raw) return { ...DEFAULT_TASTE_SETTINGS, ...(JSON.parse(raw) as Partial<TasteSettings>) };
		}
	} catch {
		/* corrupt / unavailable storage — fall back to defaults */
	}
	return { ...DEFAULT_TASTE_SETTINGS };
}

/** Reactive singleton — read `tasteSettings.signal` etc. anywhere. */
export const tasteSettings = $state<TasteSettings>(load());

export function saveTasteSettings(): void {
	try {
		localStorage.setItem(KEY, JSON.stringify({ ...tasteSettings }));
	} catch {
		/* storage unavailable — preference simply won't persist */
	}
}
