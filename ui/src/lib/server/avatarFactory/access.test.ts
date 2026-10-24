import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../../../../../');

describe('factory stays off the public digest host and STATS_ONLY', () => {
	it('hooks.server.ts STATS_ONLY allowlist does not include avatar-factory', () => {
		const src = readFileSync(resolve(repoRoot, 'ui/src/hooks.server.ts'), 'utf8');
		expect(src).toContain('STATS_ONLY');
		expect(src).not.toMatch(/avatar-factory/);
	});

	it('Caddyfile.digest does not proxy avatar-factory', () => {
		const src = readFileSync(resolve(repoRoot, 'Caddyfile.digest'), 'utf8');
		expect(src).not.toMatch(/avatar-factory/);
	});
});
