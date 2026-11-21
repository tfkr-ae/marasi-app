// Excalidraw's fonts, copied from its npm package into the app's static
// assets when the dev server or a build starts, so the canvas loads them
// from the app's own origin and never from a CDN. The copy is not
// committed (static/excalidraw-assets is ignored); the Excalidraw page sets
// EXCALIDRAW_ASSET_PATH to EXCALIDRAW_ASSET_URL. The fonts' OFL and MIT
// text (licences/excalidraw-fonts-LICENSE.txt) goes with them as LICENSE.txt.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The fonts' licence text, committed because the npm package leaves it out. */
export const FONTS_LICENCE = fileURLToPath(new URL("./licences/excalidraw-fonts-LICENSE.txt", import.meta.url));

export const EXCALIDRAW_ASSET_DIR = "excalidraw-assets";

/** Copies `<packageDir>/dist/prod/fonts` to `<staticDir>/excalidraw-assets/fonts`, replacing an older copy, with the fonts' LICENSE.txt. */
export function copyExcalidrawFonts({ packageDir, staticDir }) {
	const from = path.join(packageDir, "dist", "prod", "fonts");
	const to = path.join(staticDir, EXCALIDRAW_ASSET_DIR, "fonts");
	if (!fs.existsSync(from)) throw new Error(`Excalidraw fonts not found at ${from}; run npm install`);
	fs.rmSync(to, { recursive: true, force: true });
	fs.mkdirSync(path.dirname(to), { recursive: true });
	fs.cpSync(from, to, { recursive: true });
	fs.copyFileSync(FONTS_LICENCE, path.join(to, "LICENSE.txt"));
	return to;
}

/** The Vite plugin: copies the fonts once, before the build or dev server reads static/. */
export function excalidrawAssets({ root }) {
	let copied = false;
	return {
		name: "marasi-excalidraw-assets",
		buildStart() {
			if (copied) return;
			copied = true;
			copyExcalidrawFonts({
				packageDir: path.join(root, "node_modules", "@excalidraw", "excalidraw"),
				staticDir: path.join(root, "static"),
			});
		},
	};
}
