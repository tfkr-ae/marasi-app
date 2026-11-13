import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { openSourceNotices } from './notices.js';

export default defineConfig({
	plugins: [
		sveltekit(),
		openSourceNotices({ repoRoot: fileURLToPath(new URL('..', import.meta.url)) })
	],
	//Fix
	resolve: {
		preserveSymlinks: true, // Ensure symlinks are resolved
	},
	server: {
		host: 'localhost',
		port: 5173,
		strictPort: true,
		hmr: {
			protocol: 'ws',
			host: 'localhost',
			port: 5173,
			clientPort: 5173,
		},
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
