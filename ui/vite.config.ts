import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
// Import defineConfig from vitest/config (not 'vite') so the `test` field below
// is a recognized property. Importing from 'vite' triggers svelte-check's
// "No overload matches this call … 'test' does not exist" error (sprint-11).
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	test: { include: ['src/**/*.{test,spec}.ts'] }
});
