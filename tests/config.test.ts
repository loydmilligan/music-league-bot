import { describe, expect, it } from 'vitest';
import { rulesConfigSchema } from '../src/config/types.js';
import { loadConfig, parseConfig } from '../src/config/loader.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

describe('parseConfig', () => {
  it('returns typed config from plain object', () => {
    const raw = {
      defaults: { requireCommandPrefix: true, commandPrefix: '!song', dedupeScope: 'playlist' as const },
      rules: [{ name: 'r', enabled: true, when: { command: 'song' }, playlist: { spotify: 'P' } }],
    };
    const config = parseConfig(raw);
    expect(config.rules).toHaveLength(1);
    expect(config.rules[0].name).toBe('r');
  });

  it('throws on invalid config', () => {
    expect(() => parseConfig({ rules: 'bad' })).toThrow();
  });
});

describe('loadConfig', () => {
  it('loads and validates config from a JSON file', () => {
    const fixturePath = path.join(__dirname, 'fixtures/rules.test.json');
    const config = loadConfig(fixturePath);
    expect(config.rules[0].name).toBe('Weekly playlist');
    expect(config.rules[0].playlist.spotify).toBe('Music League - Week {{weekNumber}}');
  });

  it('throws when file does not exist', () => {
    expect(() => loadConfig('/nonexistent/rules.json')).toThrow();
  });
});
