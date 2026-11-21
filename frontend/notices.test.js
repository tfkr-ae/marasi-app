import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { licenceOf, licenceTextIn, npmNotices, packageRootOf, toolNotices } from "./notices.js";

test("a bundled module's package root, scoped or not", () => {
	assert.equal(packageRootOf("/app/node_modules/svelte/src/index.js"), "/app/node_modules/svelte");
	assert.equal(packageRootOf("/app/node_modules/@codemirror/view/dist/index.js?v=1"), "/app/node_modules/@codemirror/view");
	assert.equal(packageRootOf("/app/node_modules/a/node_modules/b/x.js"), "/app/node_modules/a/node_modules/b");
	assert.equal(packageRootOf("/app/src/lib/x.js"), null);
});

test("licence text joins LICENSE, LICENCE, COPYING and NOTICE files only", () => {
	const files = { "LICENSE.md": "MIT", "LICENSE-APACHE.txt": "Apache", NOTICE: "Notice", "README.md": "no", "license-check.js": "no" };
	const text = licenceTextIn("/p", () => Object.keys(files), (p) => files[p.slice(3)]);
	assert.equal(text, "Apache\n\nMIT\n\nNotice");
});

test("one entry per package version, sorted, with its licence", () => {
	const fsTree = {
		"/n/node_modules/b/package.json": JSON.stringify({ name: "b", version: "1.0.0", license: "MIT" }),
		"/n/node_modules/b/LICENSE": "B licence",
		"/n/node_modules/a/package.json": JSON.stringify({ name: "a", version: "2.0.0", license: { type: "ISC" } }),
	};
	const read = {
		readdir: (dir) => Object.keys(fsTree).filter((p) => p.startsWith(dir + "/")).map((p) => p.slice(dir.length + 1)),
		readFile: (p) => {
			if (!(p in fsTree)) throw new Error("ENOENT");
			return fsTree[p];
		},
	};
	const ids = ["/n/node_modules/b/x.js", "/n/node_modules/b/y.js", "/n/node_modules/a/z.js", "/n/src/app.js"];
	assert.deepEqual(npmNotices(ids, read), [
		{ name: "a", version: "2.0.0", licence: "ISC", text: "" },
		{ name: "b", version: "1.0.0", licence: "MIT", text: "B licence" },
	]);
});

test("a licence text reads as its SPDX id", () => {
	assert.equal(licenceOf("MIT License\n\nPermission is hereby granted, free of charge, to any person"), "MIT");
	assert.equal(licenceOf("                                 Apache License\n                           Version 2.0, January 2004"), "Apache-2.0");
	assert.equal(licenceOf("Redistribution and use in source and binary forms ... used to endorse or promote products"), "BSD-3-Clause");
	assert.equal(licenceOf("Redistribution and use in source and binary forms, with or without"), "BSD-2-Clause");
	assert.equal(licenceOf("Some custom terms"), "");
});

function frontendWithTools({ cyberchef = true } = {}) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "notices-"));
	const write = (rel, text) => {
		fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
		fs.writeFileSync(path.join(root, rel), text);
	};
	write("node_modules/@excalidraw/excalidraw/package.json", JSON.stringify({ name: "@excalidraw/excalidraw", version: "0.18.1" }));
	if (cyberchef) {
		write("static/tools/cyberchef/.marasi-build.json", JSON.stringify({ tag: "v11.6.0" }));
		write("static/tools/cyberchef/MARASI-NOTICE.txt", "CyberChef v11.6.0, Crown Copyright, Apache-2.0 (see LICENSE).");
		write("static/tools/cyberchef/LICENSE", "Apache License\nVersion 2.0, January 2004");
	}
	return root;
}

test("the tools credit CyberChef under Apache-2.0 and Excalidraw under MIT with its fonts' OFL", () => {
	const [chef, excalidraw] = toolNotices(frontendWithTools());

	assert.equal(chef.name, "CyberChef");
	assert.equal(chef.version, "v11.6.0");
	assert.equal(chef.licence, "Apache-2.0");
	assert.match(chef.text, /Crown Copyright/);
	assert.match(chef.text, /Apache License/);

	assert.equal(excalidraw.name, "Excalidraw");
	assert.equal(excalidraw.version, "0.18.1");
	assert.equal(excalidraw.licence, "MIT, fonts OFL-1.1");
	assert.match(excalidraw.text, /Copyright \(c\) 2020 Excalidraw/);
	assert.match(excalidraw.text, /SIL OPEN FONT LICENSE Version 1\.1/);
});

test("without a CyberChef build only Excalidraw is listed", () => {
	assert.deepEqual(toolNotices(frontendWithTools({ cyberchef: false })).map((entry) => entry.name), ["Excalidraw"]);
});
