export const PAUSED_MESSAGE = 'OpenRouter image gen paused';
export const CONFIRM_REQUIRED = 'confirm required';

type EnvBag = Record<string, string | undefined>;

/** Kill switch: paused only when the flag is `1` or `true`. Unset / `0` = enabled. */
export function isGenerationPaused(env: EnvBag = process.env): boolean {
	const v = (env.AVATAR_FACTORY_OPENROUTER_PAUSED ?? '').trim().toLowerCase();
	return v === '1' || v === 'true';
}

export function assertGenerationAllowed(env: EnvBag = process.env): void {
	if (isGenerationPaused(env)) throw new Error(PAUSED_MESSAGE);
}

/** Generate / tweak / group-shot run only after an explicit UI confirm. */
export function assertConfirmed(confirmed: unknown): void {
	if (confirmed !== true) throw new Error(CONFIRM_REQUIRED);
}
