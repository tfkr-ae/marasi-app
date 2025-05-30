import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit()
	],
	//Fix
	resolve: {
		preserveSymlinks: true, // Ensure symlinks are resolved
	},
	build: {
		rollupOptions: {
			external: []
		},
		chunkSizeWarningLimit: 1600,
	},
	css: {
		postcss: './postcss.config.js'
	}
});
