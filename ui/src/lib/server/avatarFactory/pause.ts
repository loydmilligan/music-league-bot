export const PAUSED_MESSAGE = 'OpenRouter image gen paused';

type EnvBag = Record<string, string | undefined>;

/** Allowed only when AVATAR_FACTORY_OPENROUTER_PAUSED is exactly `0`. Unset/anything else = paused. */
export function isGenerationPaused(env: EnvBag = process.env): boolean {
	return env.AVATAR_FACTORY_OPENROUTER_PAUSED !== '0';
}

export function assertGenerationAllowed(env: EnvBag = process.env): void {
	if (isGenerationPaused(env)) throw new Error(PAUSED_MESSAGE);
}
