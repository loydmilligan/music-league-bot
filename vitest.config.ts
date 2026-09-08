import { fileURLToPath } from 'node:url';
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
	// $lib is SvelteKit's alias, and the core suite is not a SvelteKit build —
	// so a ui/ module with a RUNTIME $lib import (as opposed to an erased
	// `import type`) fails to resolve here. Several ytm modules are shared by
	// both worlds; mapping the alias lets the core suite exercise them instead
	// of forcing relative paths into app code to suit the tests.
	resolve: {
		alias: {
			$lib: fileURLToPath(new URL('./ui/src/lib', import.meta.url)),
		},
	},
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
