// Builds the tool contract checks' harness (main.js) into .tool-harness/,
// with the app's static files (CyberChef's build, Excalidraw's fonts) at
// the same paths as in the app. It is separate from the app's vite.config.js
// and never part of the app's build.
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { excalidrawAssets } from "../excalidrawAssets.js";

const frontend = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
	root: fileURLToPath(new URL(".", import.meta.url)),
	publicDir: `${frontend}static`,
	plugins: [excalidrawAssets({ root: frontend }), svelte({ configFile: false })],
	build: {
		outDir: `${frontend}.tool-harness`,
		emptyOutDir: true,
		chunkSizeWarningLimit: 8000,
	},
	logLevel: "warn",
});
