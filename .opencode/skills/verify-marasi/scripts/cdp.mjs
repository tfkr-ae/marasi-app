#!/usr/bin/env node

import fs from "node:fs";

const [mode, portText, appURL, evidenceDir, widthText, heightText, feature, action, label, shortcut] = process.argv.slice(2);
const port = Number(portText);
const viewport = { width: Number(widthText), height: Number(heightText) };
if (!mode || !Number.isInteger(port) || !appURL || !evidenceDir || !Number.isInteger(viewport.width) || !Number.isInteger(viewport.height)) {
	throw new Error("usage: cdp.mjs <launch|doctor|drive> <cdp-port> <app-url> <evidence-dir> <width> <height> [feature] [compare <label> <shortcut>]");
}

const routes = {
	dashboard: { selector: '[title="Home"]', path: "/", expected: "Project Dashboard" },
	ledger: { selector: '[title="Ledger"]', path: "/ledger", expected: "Ledger Settings" },
	compass: { selector: '[title="Compass"]', path: "/compass", expected: "Compass Settings" },
	checkpoint: { selector: '[title="Checkpoint"]', path: "/checkpoint", expected: "Checkpoint" },
	launchpad: { selector: '[title="Launchpad"]', path: "/launchpad", expected: "No Launchpads" },
	armory: { selector: '[title="Armory"]', path: "/armory", expected: "Armory Settings" },
	logbook: { selector: '[title="Logbook"]', path: "/logbook", expected: "Logbook Settings" },
	workshop: { selector: '[title="Workshop"]', path: "/workshop", expected: "Workshop Settings" },
	settings: { selector: '[title="Settings"]', path: "/settings", expected: "Marasi Settings" },
};

const overlayPainted = `Boolean((() => {
	const card = document.querySelector("dialog[open], [data-testid='modal-component'] .modal-example-form, [data-testid='modal-component']");
	const box = card?.getBoundingClientRect();
	return box && box.width > 100 && box.height > 100;
})())`;

const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => {
	if (!response.ok) throw new Error(`CDP target list returned ${response.status}`);
	return response.json();
});
const target = targets.find((entry) => entry.type === "page");
if (!target?.webSocketDebuggerUrl) throw new Error("Chrome has no debuggable page target");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
	socket.addEventListener("open", resolve, { once: true });
	socket.addEventListener("error", reject, { once: true });
});

let nextID = 1;
const pending = new Map();
const consoleEvents = [];
const networkEvents = [];
socket.addEventListener("message", ({ data }) => {
	const message = JSON.parse(data);
	if (message.id) {
		const waiter = pending.get(message.id);
		if (!waiter) return;
		pending.delete(message.id);
		if (message.error) waiter.reject(new Error(message.error.message));
		else waiter.resolve(message.result);
		return;
	}
	if (message.method === "Runtime.consoleAPICalled" || message.method === "Log.entryAdded") consoleEvents.push(message);
	if (message.method?.startsWith("Network.")) networkEvents.push(message);
});

function send(method, params = {}) {
	const id = nextID++;
	socket.send(JSON.stringify({ id, method, params }));
	return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
	const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
	if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
	return result.result.value;
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(expression, description, attempts = 60, interval = 1000) {
	for (let attempt = 0; attempt < attempts; attempt++) {
		if (await evaluate(expression)) return;
		await sleep(interval);
	}
	throw new Error(`timed out waiting for ${description}`);
}

async function snapshot() {
	return evaluate(`(() => {
		const overlay = document.querySelector("dialog[open], [data-testid='modal-component']");
		const card = overlay?.querySelector(".modal-example-form") || overlay;
		const rect = card?.getBoundingClientRect?.();
		return {
			url: location.href,
			path: location.pathname,
			title: document.title,
			viewport: {width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio},
			text: document.body.innerText,
			overlay: overlay && rect && rect.width > 100 && rect.height > 100 ? {
				label: overlay.getAttribute("aria-label") || overlay.querySelector("h2")?.textContent || null,
				text: overlay.innerText,
				rect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height},
			} : null,
			html: document.documentElement.outerHTML,
		};
	})()`);
}

async function capture(prefix, state = null) {
	const captured = state || await snapshot();
	fs.writeFileSync(`${evidenceDir}/${prefix}.json`, `${JSON.stringify(captured, null, 2)}\n`);
	const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
	fs.writeFileSync(`${evidenceDir}/${prefix}.png`, screenshot.data, "base64");
	if (captured.overlay?.rect) {
		const clip = {
			x: Math.max(0, captured.overlay.rect.x),
			y: Math.max(0, captured.overlay.rect.y),
			width: captured.overlay.rect.width,
			height: captured.overlay.rect.height,
			scale: 1,
		};
		const cropped = await send("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: true });
		fs.writeFileSync(`${evidenceDir}/${prefix}-overlay.png`, cropped.data, "base64");
	}
	return captured;
}

function assertPaintedPoint(point, description) {
	if (!point || point.error) throw new Error(`${description}: ${point?.error || "not found"}`);
	if (!(point.width > 10) || !(point.height > 10) || point.x <= 0 || point.y <= 0) {
		throw new Error(`${description} is not painted: ${JSON.stringify(point)}`);
	}
}

async function clickPoint(point) {
	await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
	await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
	await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
}

function parseShortcut(text) {
	const parts = String(text)
		.toLowerCase()
		.replace(/⌘/g, "cmd")
		.replace(/⇧/g, "shift")
		.split("+")
		.map((part) => part.trim())
		.filter(Boolean);
	const key = parts.pop();
	if (!key) throw new Error(`invalid shortcut: ${text}`);
	return {
		meta: parts.includes("cmd") || parts.includes("command") || parts.includes("meta"),
		shift: parts.includes("shift"),
		ctrl: parts.includes("ctrl") || parts.includes("control"),
		alt: parts.includes("alt"),
		key,
	};
}

function keyEvent(key) {
	if (/^[a-z]$/.test(key)) return { key, code: `Key${key.toUpperCase()}`, keyCode: key.toUpperCase().charCodeAt(0) };
	if (/^[0-9]$/.test(key)) return { key, code: `Digit${key}`, keyCode: 48 + Number(key) };
	const specials = {
		",": { key: ",", code: "Comma", keyCode: 188 },
		".": { key: ".", code: "Period", keyCode: 190 },
		"`": { key: "`", code: "Backquote", keyCode: 192 },
		enter: { key: "Enter", code: "Enter", keyCode: 13 },
		escape: { key: "Escape", code: "Escape", keyCode: 27 },
	};
	if (!specials[key]) throw new Error(`unsupported shortcut key: ${key}`);
	return specials[key];
}

async function pressKey(type, key, code, keyCode, modifiers = 0, extra = {}) {
	await send("Input.dispatchKeyEvent", {
		type,
		modifiers,
		key,
		code,
		windowsVirtualKeyCode: keyCode,
		nativeVirtualKeyCode: keyCode,
		...extra,
	});
}

async function pressShortcut(text) {
	const parsed = parseShortcut(text);
	const event = keyEvent(parsed.key);
	const modifiers = (parsed.alt ? 1 : 0) | (parsed.ctrl ? 2 : 0) | (parsed.meta ? 4 : 0) | (parsed.shift ? 8 : 0);
	if (parsed.meta) await pressKey("keyDown", "Meta", "MetaLeft", 91, modifiers, { location: 1 });
	if (parsed.shift) await pressKey("keyDown", "Shift", "ShiftLeft", 16, modifiers);
	if (parsed.ctrl) await pressKey("keyDown", "Control", "ControlLeft", 17, modifiers);
	if (parsed.alt) await pressKey("keyDown", "Alt", "AltLeft", 18, modifiers);
	await pressKey("rawKeyDown", event.key, event.code, event.keyCode, modifiers, { text: "", unmodifiedText: "" });
	await pressKey("keyUp", event.key, event.code, event.keyCode, modifiers);
	if (parsed.alt) await pressKey("keyUp", "Alt", "AltLeft", 18, modifiers & ~1);
	if (parsed.ctrl) await pressKey("keyUp", "Control", "ControlLeft", 17, modifiers & ~2);
	if (parsed.shift) await pressKey("keyUp", "Shift", "ShiftLeft", 16, modifiers & ~8);
	if (parsed.meta) await pressKey("keyUp", "Meta", "MetaLeft", 91, 0, { location: 1 });
}

async function pressEscape() {
	await pressKey("keyDown", "Escape", "Escape", 27);
	await pressKey("keyUp", "Escape", "Escape", 27);
}

function slug(text) {
	return String(text)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "") || "action";
}

function resultOf(state) {
	if (state.overlay) return { kind: "overlay", label: state.overlay.label, text: state.overlay.text, rect: state.overlay.rect, path: state.path };
	return { kind: "page", label: null, text: null, rect: null, path: state.path };
}

async function driveRoute(route) {
	await capture(`${feature}-before`);
	fs.writeFileSync(`${evidenceDir}/${feature}-action.txt`, `input=left mouse click\nselector=${route.selector}\nexpected_path=${route.path}\nexpected_text=${route.expected}\n`);
	const point = await evaluate(`(() => {
		const element = document.querySelector(${JSON.stringify(route.selector)});
		if (!element) return {error: "selector not found"};
		const box = element.getBoundingClientRect();
		return {x: box.left + box.width / 2, y: box.top + box.height / 2, width: box.width, height: box.height};
	})()`);
	assertPaintedPoint(point, route.selector);
	await clickPoint(point);
	await waitFor(`location.pathname === ${JSON.stringify(route.path)} && document.body.innerText.includes(${JSON.stringify(route.expected)})`, `${feature} route and text`, 20);
	await capture(`${feature}-after`);
	fs.writeFileSync(`${evidenceDir}/${feature}-console.json`, `${JSON.stringify(consoleEvents, null, 2)}\n`);
	fs.writeFileSync(`${evidenceDir}/${feature}-network.json`, `${JSON.stringify(networkEvents, null, 2)}\n`);
	console.log(`feature=${feature}\nresult=path ${route.path}, visible text: ${route.expected}\nevidence=${evidenceDir}`);
}

async function driveCompare(route) {
	if (!label || !shortcut) throw new Error("compare requires a visible label and a MarasiKeys shortcut");
	await waitFor(`location.pathname === ${JSON.stringify(route.path)} && document.body.innerText.includes(${JSON.stringify(route.expected)})`, `${feature} route`, 20);
	const name = slug(label);
	const point = await evaluate(`(() => {
		const wanted = ${JSON.stringify(label)};
		const nodes = Array.from(document.querySelectorAll("button, a, [role='button']"));
		const painted = nodes.map((el) => {
			const box = el.getBoundingClientRect();
			return {
				text: el.innerText.replace(/\\s+/g, " ").trim(),
				x: box.left + box.width / 2,
				y: box.top + box.height / 2,
				width: box.width,
				height: box.height,
				inDialog: Boolean(el.closest("dialog")),
			};
		}).filter((el) => el.width > 10 && el.height > 10 && !el.inDialog && (el.text === wanted || el.text.startsWith(wanted)));
		const exact = painted.find((el) => el.text === wanted);
		return exact || painted[0] || {error: "painted control not found"};
	})()`);
	assertPaintedPoint(point, `visible "${label}"`);

	await capture(`${name}-click-before`);
	fs.writeFileSync(`${evidenceDir}/${name}-click-action.txt`, `input=left mouse click\ncontrol=painted "${label}"\nclick=${JSON.stringify(point)}\n`);
	await clickPoint(point);
	await waitFor(`${overlayPainted} || location.pathname !== ${JSON.stringify(route.path)}`, `click of "${label}" changed the page or painted an overlay`, 20, 250);
	await sleep(400);
	const clickAfter = await capture(`${name}-click-after`);
	const clickResult = resultOf(clickAfter);

	if (clickResult.kind === "overlay") {
		await pressEscape();
		await waitFor(`!${overlayPainted}`, "overlay closed", 20, 250);
		await sleep(200);
	} else if (clickResult.path !== route.path) {
		const restorePoint = await evaluate(`(() => {
			const element = document.querySelector(${JSON.stringify(route.selector)});
			if (!element) return {error: "feature rail not found"};
			const box = element.getBoundingClientRect();
			return {x: box.left + box.width / 2, y: box.top + box.height / 2, width: box.width, height: box.height};
		})()`);
		assertPaintedPoint(restorePoint, route.selector);
		await clickPoint(restorePoint);
		await waitFor(`location.pathname === ${JSON.stringify(route.path)}`, `return to ${feature}`, 20);
	}

	await capture(`${name}-shortcut-before`);
	fs.writeFileSync(
		`${evidenceDir}/${name}-shortcut-action.txt`,
		`input=keyboard shortcut through Chrome CDP Input.dispatchKeyEvent\nshortcut=${shortcut}\nbinding=MarasiKeys\nexpected=same result as clicking painted "${label}"\n`,
	);
	await pressShortcut(shortcut);
	await waitFor(`${overlayPainted} || location.pathname !== ${JSON.stringify(route.path)}`, `shortcut ${shortcut} changed the page or painted an overlay`, 20, 250);
	await sleep(400);
	const shortcutAfter = await capture(`${name}-shortcut-after`);
	const shortcutResult = resultOf(shortcutAfter);
	const compare = {
		label,
		shortcut,
		click: clickResult,
		shortcut: shortcutResult,
		sameKind: clickResult.kind === shortcutResult.kind,
		samePath: clickResult.path === shortcutResult.path,
		sameOverlay: clickResult.kind !== "overlay" || clickResult.text === shortcutResult.text,
	};
	fs.writeFileSync(`${evidenceDir}/${name}-compare.json`, `${JSON.stringify(compare, null, 2)}\n`);
	fs.writeFileSync(`${evidenceDir}/${name}-console.json`, `${JSON.stringify(consoleEvents, null, 2)}\n`);
	fs.writeFileSync(`${evidenceDir}/${name}-network.json`, `${JSON.stringify(networkEvents, null, 2)}\n`);
	if (!compare.sameKind || !compare.samePath || !compare.sameOverlay) {
		throw new Error(`${shortcut} did not match clicking "${label}": ${JSON.stringify(compare)}`);
	}
	console.log(`feature=${feature}\naction=compare\nlabel=${label}\nshortcut=${shortcut}\nresult=${clickResult.kind} matched\nevidence=${evidenceDir}`);
}

await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");
await send("Network.enable");
await send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: false });

if (mode === "launch") {
	await send("Page.navigate", { url: appURL });
	await waitFor(`document.body?.innerText.includes("Project Dashboard")`, "dashboard readiness", 120);
	await capture("launch-ready");
} else if (mode === "doctor") {
	await waitFor(`location.origin === ${JSON.stringify(new URL(appURL).origin)} && window.go?.main?.App && window.runtime && innerWidth === ${viewport.width} && innerHeight === ${viewport.height} && devicePixelRatio === 1 && document.querySelector('[title="Home"]')`, "healthy Marasi browser page, Wails bridge, app rail, and viewport", 5);
} else if (mode === "drive") {
	const route = routes[feature];
	if (!route) throw new Error(`unknown feature: ${feature}`);
	if (action === "compare") await driveCompare(route);
	else if (action) throw new Error(`unknown action: ${action}`);
	else await driveRoute(route);
} else {
	throw new Error(`unknown mode: ${mode}`);
}

socket.close();
