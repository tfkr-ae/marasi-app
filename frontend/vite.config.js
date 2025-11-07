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
			external: [],
			output: {
				manualChunks: (id) => {
					if (id.includes('node_modules')) {
						if (id.includes('@skeletonlabs/skeleton') ||
							id.includes('lucide-svelte') ||
							id.includes('svelte-feather-icons')) {
							return 'vendor';
						}
						if (id.includes('@codemirror') ||
							id.includes('svelte-codemirror-editor')) {
							return 'codemirror';
						}
					}
				}
			}
		},
		chunkSizeWarningLimit: 1600,
	},
	css: {
		postcss: './postcss.config.js'
	}
});
