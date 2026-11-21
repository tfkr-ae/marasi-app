import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { copyExcalidrawFonts } from "./excalidrawAssets.js";

function tempDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "excalidraw-assets-"));
}

test("the fonts land under static/excalidraw-assets/fonts, replacing a stale copy", () => {
	const packageDir = tempDir();
	const staticDir = tempDir();
	fs.mkdirSync(path.join(packageDir, "dist", "prod", "fonts", "Virgil"), { recursive: true });
	fs.writeFileSync(path.join(packageDir, "dist", "prod", "fonts", "Virgil", "Virgil-Regular.woff2"), "font");
	fs.mkdirSync(path.join(staticDir, "excalidraw-assets", "fonts", "Old"), { recursive: true });

	copyExcalidrawFonts({ packageDir, staticDir });

	const fonts = path.join(staticDir, "excalidraw-assets", "fonts");
	assert.equal(fs.readFileSync(path.join(fonts, "Virgil", "Virgil-Regular.woff2"), "utf8"), "font");
	assert.equal(fs.existsSync(path.join(fonts, "Old")), false);
});

test("a missing package says to install it", () => {
	assert.throws(() => copyExcalidrawFonts({ packageDir: tempDir(), staticDir: tempDir() }), /npm install/);
});
