import { defineConfig } from 'vitest/config';

// Root (bot/core) vitest config. The suite lives entirely under tests/.
// Without an explicit include/exclude, vitest scans the whole project root
// and crashes on the root-owned WhatsApp container profile
// (.wwebjs_auth/session, EACCES) and the separate SvelteKit app under ui/.
// Scope collection to tests/ and exclude non-suite trees explicitly.
//
// NOTE: this is the core suite config only — the frontend app keeps its own
// ui/vite.config.ts.
export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		exclude: [
			'**/node_modules/**',
			'**/dist/**',
			'.wwebjs_auth/**',
			'ui/**',
			'musicleague/**',
			'data/**',
		],
	},
});
