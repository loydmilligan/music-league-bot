import { describe, expect, it } from 'vitest';
import { rulesConfigSchema } from '../src/config/types.js';

describe('rulesConfigSchema', () => {
  it('parses a valid config', () => {
    const raw = {
      defaults: { requireCommandPrefix: true, commandPrefix: '!song', dedupeScope: 'playlist' },
      rules: [
        {
          name: 'Test rule',
          enabled: true,
          when: { command: 'song' },
          playlist: { spotify: 'Test Playlist' },
        },
      ],
    };
    const result = rulesConfigSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rules[0].name).toBe('Test rule');
    }
  });

  it('rejects a config missing rules array', () => {
    const result = rulesConfigSchema.safeParse({ defaults: {}, rules: 'bad' });
    expect(result.success).toBe(false);
  });
});
