export const PAUSED_MESSAGE = 'OpenRouter image gen paused';
export const CONFIRM_REQUIRED = 'confirm required';

type EnvBag = Record<string, string | undefined>;

function flagOn(v: string | undefined): boolean {
	const s = (v ?? '').trim().toLowerCase();
	return s === '1' || s === 'true';
}

/** Kill switch: paused when OPENROUTER_PAUSED or GEN_PAUSED is `1`/`true`. Unset / `0` = enabled. */
export function isGenerationPaused(env: EnvBag = process.env): boolean {
	return flagOn(env.AVATAR_FACTORY_GEN_PAUSED) || flagOn(env.AVATAR_FACTORY_OPENROUTER_PAUSED);
}

export function assertGenerationAllowed(env: EnvBag = process.env): void {
	if (isGenerationPaused(env)) throw new Error(PAUSED_MESSAGE);
}

/** Generate / tweak / group-shot run only after an explicit UI confirm. */
export function assertConfirmed(confirmed: unknown): void {
	if (confirmed !== true) throw new Error(CONFIRM_REQUIRED);
}
