// The open-source notices behind Settings → About's licences list: each
// library the app ships, with its licence text. A Vite plugin writes them
// to licences.json next to the app at build time: the npm packages in the
// client bundle and the Go modules the app binary links (`go list -deps`),
// plus Go itself. The dev server has no file, and the list says so.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const LICENCE_FILE = /^(licen[cs]e|copying|notice)([.-][a-z0-9-]+)?(\.(md|txt|markdown))?$/i;

/** The package directory of a bundled module id, or null outside node_modules. */
export function packageRootOf(id) {
	const clean = id.replace(/^\0/, "").split("?")[0];
	const match = clean.match(/^(.*[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)/);
	return match ? match[1] : null;
}

/** The licence text in a directory: its LICENSE, LICENCE, COPYING or NOTICE files, joined. */
export function licenceTextIn(dir, readdir = fs.readdirSync, readFile = fs.readFileSync) {
	let names;
	try {
		names = readdir(dir);
	} catch {
		return "";
	}
	return names
		.filter((name) => LICENCE_FILE.test(name))
		.sort()
		.map((name) => {
			try {
				return readFile(path.join(dir, name), "utf8").trim();
			} catch {
				return "";
			}
		})
		.filter(Boolean)
		.join("\n\n");
}

/** The SPDX id a licence text reads as, for the common licences; "" otherwise. */
export function licenceOf(text) {
	if (/Apache License,?\s+Version 2\.0/i.test(text)) return "Apache-2.0";
	if (/Mozilla Public License,?\s+(v\.|version)\s*2\.0/i.test(text)) return "MPL-2.0";
	if (/Permission is hereby granted, free of charge/i.test(text)) return "MIT";
	if (/Permission to use, copy, modify, and\/or distribute/i.test(text)) return "ISC";
	if (/Redistribution and use in source and binary forms/i.test(text)) {
		return /endorse or promote products/i.test(text) ? "BSD-3-Clause" : "BSD-2-Clause";
	}
	return "";
}

/** The npm packages in a bundle's module ids, one entry per name and version. */
export function npmNotices(moduleIds, read = { readdir: fs.readdirSync, readFile: fs.readFileSync }) {
	const roots = new Set();
	for (const id of moduleIds) {
		const root = packageRootOf(id);
		if (root) roots.add(root);
	}
	const byKey = new Map();
	for (const root of roots) {
		let pkg;
		try {
			pkg = JSON.parse(read.readFile(path.join(root, "package.json"), "utf8"));
		} catch {
			continue;
		}
		const key = `${pkg.name}@${pkg.version}`;
		if (byKey.has(key)) continue;
		const text = licenceTextIn(root, read.readdir, read.readFile);
		const declared = typeof pkg.license === "string" ? pkg.license : (pkg.license?.type ?? "");
		byKey.set(key, { name: pkg.name, version: pkg.version, licence: declared || licenceOf(text), text });
	}
	return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The Go modules the app links, and Go itself; none when Go can't answer. */
export function goNotices(repoRoot) {
	const env = { ...process.env, GOWORK: "off" };
	let list;
	let goroot;
	try {
		list = execFileSync("go", ["list", "-deps", "-f", "{{with .Module}}{{if not .Main}}{{.Path}}\t{{.Version}}\t{{.Dir}}{{end}}{{end}}", "."], {
			cwd: repoRoot,
			env,
			encoding: "utf8",
		});
		goroot = execFileSync("go", ["env", "GOROOT"], { cwd: repoRoot, env, encoding: "utf8" }).trim();
	} catch (error) {
		console.warn(`licences: no Go modules (${error.message.split("\n")[0]})`);
		return [];
	}
	const seen = new Set();
	const modules = [];
	for (const line of list.split("\n")) {
		const [name, version, dir] = line.split("\t");
		if (!name || seen.has(name)) continue;
		seen.add(name);
		const text = licenceTextIn(dir);
		modules.push({ name, version: version ?? "", licence: licenceOf(text), text });
	}
	modules.sort((a, b) => a.name.localeCompare(b.name));
	const goVersion = fs.existsSync(path.join(goroot, "VERSION")) ? fs.readFileSync(path.join(goroot, "VERSION"), "utf8").split("\n")[0] : "";
	return [{ name: "Go", version: goVersion, licence: "BSD-3-Clause", text: licenceTextIn(goroot) }, ...modules];
}

/** The Vite plugin: writes licences.json into the client build. */
export function openSourceNotices({ repoRoot }) {
	let ssr = false;
	return {
		name: "marasi-open-source-notices",
		apply: "build",
		configResolved(config) {
			ssr = !!config.build.ssr;
		},
		generateBundle() {
			if (ssr) return;
			const notices = { go: goNotices(repoRoot), npm: npmNotices(this.getModuleIds()) };
			this.emitFile({ type: "asset", fileName: "licences.json", source: JSON.stringify(notices) });
		},
	};
}
