import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [svelte()],
	build: {
		outDir: 'dist',
		emptyOutDir: true,
		rollupOptions: {
			output: {
				entryFileNames: 'bside.js',
				chunkFileNames: 'bside-[name].js',
				assetFileNames: (info) => {
					if (info.name?.endsWith('.css')) return 'bside.css';
					return '[name][extname]';
				},
			},
		},
	},
});
