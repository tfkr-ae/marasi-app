import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDevBridge } from './devBridge.js';
import { callSocket } from '../electron/socket.js';

// MARASI_DEV_PORT moves the dev server off 5173, as when another one has it.
const port = Number(process.env.MARASI_DEV_PORT) || 5173;

// In a plain browser, the dev server stands in for Electron's main process
// on the instances in MARASI_CONFIG_DIR (devBridge.js).
const marasiDevBridge = {
	name: 'marasi-dev-bridge',
	apply: 'serve',
	configureServer(server) {
		const configDir = process.env.MARASI_CONFIG_DIR ? resolve(process.env.MARASI_CONFIG_DIR) : null;
		const bridge = createDevBridge({ configDir, call: callSocket, readdir });
		server.middlewares.use((req, res, next) => bridge.handle(req, res, next));
	}
};

export default defineConfig({
	plugins: [
		marasiDevBridge,
		sveltekit()
	],
	//Fix
	resolve: {
		preserveSymlinks: true, // Ensure symlinks are resolved
	},
	server: {
		host: 'localhost',
		port,
		strictPort: true,
		hmr: {
			protocol: 'ws',
			host: 'localhost',
			port,
			clientPort: port,
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
