import { test } from "node:test";
import assert from "node:assert/strict";
import { licenceOf, licenceTextIn, npmNotices, packageRootOf } from "./notices.js";

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
