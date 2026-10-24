import { DEFAULT_FACTORY_MODEL } from './openrouter.js';
import { isGenerationPaused } from './pause.js';

export const DEFAULT_PROVIDER = 'openrouter' as const;
export const DISABLED_PENDING = 'disabled pending Mashew OK';

export const OPENROUTER_PRICING_BASIS =
	'OpenRouter usage.cost when present; else ~$0.04/image estimate';
export const RUNWAY_PRICING_BASIS =
	'gen4_image 720p: 5 credits × $0.01 = $0.05 (https://docs.dev.runwayml.com/guides/pricing/)';
export const FAL_PRICING_BASIS =
	'fal-ai/nano-banana/edit $0.0398/image (https://fal.ai/models/fal-ai/nano-banana/edit)';

export type ProviderId = 'openrouter' | 'grok' | 'runway' | 'fal';

export interface ProviderDef {
	id: ProviderId;
	label: string;
	envVars: readonly string[];
	defaultModel: string;
	estimatedCostUsd: number;
	pricingBasis: string;
}

export interface ProviderStatus {
	id: ProviderId;
	label: string;
	model: string;
	estimatedCostUsd: number;
	pricingBasis: string;
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
		pricingBasis: OPENROUTER_PRICING_BASIS,
	},
	{
		id: 'grok',
		label: 'Grok',
		envVars: ['XAI_API_KEY', 'GROK_API_KEY'],
		defaultModel: 'grok-imagine-image-2.0',
		estimatedCostUsd: 0.04,
		pricingBasis: 'Grok Imagine disabled — no xAI key',
	},
	{
		id: 'runway',
		label: 'Runway',
		envVars: ['RUNWAY_API_SECRET', 'RUNWAYML_API_SECRET'],
		defaultModel: 'gen4_image',
		estimatedCostUsd: 0.05,
		pricingBasis: RUNWAY_PRICING_BASIS,
	},
	{
		id: 'fal',
		label: 'fal.ai',
		envVars: ['FAL_KEY'],
		defaultModel: 'fal-ai/nano-banana/edit',
		estimatedCostUsd: 0.0398,
		pricingBasis: FAL_PRICING_BASIS,
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

function generationAllowed(id: ProviderId): boolean {
	return id === 'openrouter' || id === 'runway' || id === 'fal';
}

export function listProviders(env: EnvBag = process.env): ProviderStatus[] {
	const paused = isGenerationPaused(env);
	return PROVIDER_CATALOG.map((p) => {
		const hasKey = envKeyPresent(p.envVars, env);
		const isDefault = p.id === DEFAULT_PROVIDER;
		const allowed = generationAllowed(p.id);
		let disabledReason: string | null = null;
		if (!allowed) {
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
			estimatedCostUsd: p.estimatedCostUsd,
			pricingBasis: p.pricingBasis,
			needsKey: !hasKey,
			enabled: allowed,
			available: allowed && hasKey && !paused,
			isDefault,
			disabledReason,
		};
	});
}

/** OpenRouter, Runway, and fal.ai when keyed. Grok stays listed and is never enabled. */
export function resolveProvider(id: string | undefined, env: EnvBag = process.env): ProviderDef {
	const chosen = id && id.length ? id : DEFAULT_PROVIDER;
	const def = providerDef(chosen);
	if (!def) throw new Error('unknown provider');
	if (!generationAllowed(def.id)) {
		throw new Error(
			envKeyPresent(def.envVars, env) ? `${def.label} ${DISABLED_PENDING}` : `${def.label} needs key`,
		);
	}
	if (!envKeyPresent(def.envVars, env)) {
		throw new Error(`${def.label} needs key`);
	}
	return def;
}
