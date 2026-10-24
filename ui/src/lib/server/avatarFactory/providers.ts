import { DEFAULT_FACTORY_MODEL } from './openrouter.js';
import { isGenerationPaused } from './pause.js';

export const DEFAULT_PROVIDER = 'openrouter' as const;
export const DISABLED_PENDING = 'disabled pending Mashew OK';

export type ProviderId = 'openrouter' | 'grok' | 'runway' | 'fal';

export interface ProviderDef {
	id: ProviderId;
	label: string;
	envVars: readonly string[];
	defaultModel: string;
	estimatedCostUsd: number;
}

export interface ProviderStatus {
	id: ProviderId;
	label: string;
	model: string;
	available: boolean;
	needsKey: boolean;
	enabled: boolean;
	isDefault: boolean;
	disabledReason: string | null;
}

export const PROVIDER_CATALOG: readonly ProviderDef[] = [
	{
		id: 'openrouter',
		label: 'OpenRouter (Gemini)',
		envVars: ['OPENROUTER_API_KEY'],
		defaultModel: DEFAULT_FACTORY_MODEL,
		estimatedCostUsd: 0.04,
	},
	{
		id: 'grok',
		label: 'Grok',
		envVars: ['XAI_API_KEY', 'GROK_API_KEY'],
		defaultModel: 'grok-imagine-image-2.0',
		estimatedCostUsd: 0.04,
	},
	{
		id: 'runway',
		label: 'Runway',
		envVars: ['RUNWAYML_API_SECRET', 'RUNWAY_API_KEY'],
		defaultModel: 'gen4_image',
		estimatedCostUsd: 0.08,
	},
	{
		id: 'fal',
		label: 'fal.ai',
		envVars: ['FAL_KEY'],
		defaultModel: 'fal-ai/flux/dev',
		estimatedCostUsd: 0.03,
	},
] as const;

type EnvBag = Record<string, string | undefined>;

/** Presence only — never return or log the value. */
export function envKeyPresent(names: readonly string[], env: EnvBag = process.env): boolean {
	return names.some((n) => !!env[n]);
}

export function providerDef(id: string): ProviderDef | undefined {
	return PROVIDER_CATALOG.find((p) => p.id === id);
}

export function listProviders(env: EnvBag = process.env): ProviderStatus[] {
	const paused = isGenerationPaused(env);
	return PROVIDER_CATALOG.map((p) => {
		const hasKey = envKeyPresent(p.envVars, env);
		const isDefault = p.id === DEFAULT_PROVIDER;
		let disabledReason: string | null = null;
		if (!isDefault) {
			disabledReason = hasKey ? DISABLED_PENDING : 'needs key';
		} else if (paused) {
			disabledReason = 'paused';
		} else if (!hasKey) {
			disabledReason = 'needs key';
		}
		return {
			id: p.id,
			label: p.label,
			model: p.defaultModel,
			needsKey: !hasKey,
			enabled: isDefault,
			available: isDefault && hasKey && !paused,
			isDefault,
			disabledReason,
		};
	});
}

/** OpenRouter only. Grok / Runway / fal stay listed and are never enabled for generation. */
export function resolveProvider(id: string | undefined, env: EnvBag = process.env): ProviderDef {
	const chosen = id && id.length ? id : DEFAULT_PROVIDER;
	const def = providerDef(chosen);
	if (!def) throw new Error('unknown provider');
	if (def.id !== DEFAULT_PROVIDER) {
		throw new Error(
			envKeyPresent(def.envVars, env) ? `${def.label} ${DISABLED_PENDING}` : `${def.label} needs key`,
		);
	}
	return def;
}
