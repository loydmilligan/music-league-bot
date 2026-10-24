import { generateFalImage } from './fal.js';
import { generateOpenRouterImage, type FetchLike, type GenerateImageOpts, type ImageGenResult } from './openrouter.js';
import { DISABLED_PENDING, type ProviderDef } from './providers.js';
import { generateRunwayImage } from './runway.js';

export type { FetchLike, GenerateImageOpts, ImageGenResult };

export async function generateFactoryImage(
	provider: ProviderDef,
	opts: GenerateImageOpts,
): Promise<ImageGenResult> {
	switch (provider.id) {
		case 'openrouter':
			return generateOpenRouterImage({ ...opts, model: provider.defaultModel });
		case 'runway':
			return generateRunwayImage({ ...opts, model: provider.defaultModel });
		case 'fal':
			return generateFalImage({ ...opts, model: provider.defaultModel });
		default:
			throw new Error(`${provider.label} ${DISABLED_PENDING}`);
	}
}
