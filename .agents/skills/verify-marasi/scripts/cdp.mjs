#!/usr/bin/env node

import fs from "node:fs";
import { deduplicateBridgeHTML } from "./bridge-html.mjs";
import { normalizeListenerStartup } from "./listener-startup.mjs";
import { collectExpression, pickTarget, sameBox } from "./targets.mjs";

const [mode, portText, appURL, evidenceDir, widthText, heightText, feature, action, label, shortcut] = process.argv.slice(2);
const port = Number(portText);
const viewport = { width: Number(widthText), height: Number(heightText) };
const pollMs = 100;
const defaultTimeoutMs = 10000;
const codeMirrorCommitMs = 350;
if (!mode || !Number.isInteger(port) || !appURL || !evidenceDir || !Number.isInteger(viewport.width) || !Number.isInteger(viewport.height)) {
	throw new Error("usage: cdp.mjs <launch|doctor|drive> <cdp-port> <app-url> <evidence-dir> <width> <height> [feature] [compare <label> <shortcut>|steps <json>|theme]");
}

// `expected` must be text only the destination page paints. Rail labels are
// always visible, so a bare feature name proves nothing.
const routes = {
	dashboard: { selector: '[title="Home"]', path: "/", expected: "Project Dashboard" },
	ledger: { selector: '[title="Ledger"]', path: "/ledger", expected: "Ledger Settings" },
	compass: { selector: '[title="Compass"]', path: "/compass", expected: "Compass Settings" },
	checkpoint: { selector: '[title="Checkpoint"]', path: "/checkpoint", expected: "Checkpoint Settings" },
	launchpad: { selector: '[title="Launchpad"]', path: "/launchpad", expected: "Launchpad Settings" },
	armory: { selector: '[title="Armory"]', path: "/armory", expected: "Armory Settings" },
	logbook: { selector: '[title="Logbook"]', path: "/logbook", expected: "Logbook Settings" },
	workshop: { selector: '[title="Workshop"]', path: "/workshop", expected: "Workshop Settings" },
	settings: { selector: '[title="Settings"]', path: "/settings", expected: "Marasi Settings" },
};

const overlayPainted = `Boolean((() => {
	const overlay = document.querySelector("dialog[open], [data-testid='modal-component']");
	const card = overlay?.querySelector(".modal-example-form") || overlay;
	const box = card?.getBoundingClientRect();
	return box && box.width > 100 && box.height > 100;
})())`;

const viewportMatches = `innerWidth === ${viewport.width} && innerHeight === ${viewport.height} && devicePixelRatio === 1`;

const appOrigin = new URL(appURL).origin;
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => {
	if (!response.ok) throw new Error(`CDP target list returned ${response.status}`);
	return response.json();
});
const pages = targets.filter((entry) => entry.type === "page");
const target = mode === "launch"
	? pages.find((entry) => entry.url === "about:blank") || pages.find((entry) => entry.url?.startsWith(appOrigin)) || pages[0]
	: pages.find((entry) => entry.url?.startsWith(appOrigin));
if (!target?.webSocketDebuggerUrl) {
	throw new Error(`Chrome has no Marasi page at ${appOrigin}; pages=${JSON.stringify(pages.map((entry) => entry.url))}`);
}

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
	if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
	return result.result.value;
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Polls a page condition. A navigation can destroy the execution context
// mid-poll; that counts as "not yet", and the last error is reported on
// timeout.
async function waitFor(expression, description, timeoutMs = defaultTimeoutMs) {
	const deadline = Date.now() + timeoutMs;
	let lastError;
	while (true) {
		try {
			if (await evaluate(expression)) return;
			lastError = undefined;
		} catch (error) {
			lastError = error;
		}
		if (Date.now() >= deadline) {
			throw new Error(`timed out after ${timeoutMs} ms waiting for ${description}${lastError ? ` (last error: ${lastError.message})` : ""}`);
		}
		await sleep(pollMs);
	}
}

// Waits until `spec` names exactly one actionable control whose box held
// still for two consecutive polls, scrolling a unique off-screen match into
// view. Returns that control's centre and box.
async function waitForTarget(spec, { timeoutMs = defaultTimeoutMs, nth, enabled = true } = {}) {
	const deadline = Date.now() + timeoutMs;
	let previous;
	let reason = "no poll completed";
	while (true) {
		let candidates;
		try {
			candidates = await evaluate(collectExpression(spec));
		} catch (error) {
			candidates = null;
			reason = `page error: ${error.message}`;
		}
		if (candidates) {
			const picked = pickTarget(candidates, { nth, enabled });
			if (picked.scroll !== undefined) {
				await evaluate(`window.__verifyTargets[${picked.scroll}].scrollIntoView({block: "center", inline: "center"})`);
				reason = "scrolled the match into view";
				previous = undefined;
			} else if (picked.target) {
				if (sameBox(previous, picked.target)) return picked.target;
				reason = "match is still moving";
				previous = picked.target;
			} else {
				reason = picked.pending;
				previous = undefined;
			}
		}
		if (Date.now() >= deadline) throw new Error(`timed out after ${timeoutMs} ms waiting for ${JSON.stringify(spec)}: ${reason}`);
		await sleep(pollMs);
	}
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
			bridgeScripts: Object.fromEntries(["/wails/ipc.js", "/wails/runtime.js"].map(path => [path, Array.from(document.scripts).filter(script => script.src === location.origin + path).length])),
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

async function clickPoint(point, button = "left") {
	await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
	await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button, clickCount: 1 });
	await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button, clickCount: 1 });
}

async function clickTarget(spec, options = {}) {
	const point = await waitForTarget(spec, options);
	await clickPoint(point, options.button);
	return point;
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
		"[": { key: "[", code: "BracketLeft", keyCode: 219 },
		"]": { key: "]", code: "BracketRight", keyCode: 221 },
		enter: { key: "Enter", code: "Enter", keyCode: 13 },
		escape: { key: "Escape", code: "Escape", keyCode: 27 },
		backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
		tab: { key: "Tab", code: "Tab", keyCode: 9 },
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
	await pressKey("rawKeyDown", event.key, event.code, event.keyCode, modifiers, {
		text: "", unmodifiedText: "",
		...(parsed.meta && parsed.key === "a" ? {commands: ["selectAll"]} : {}),
	});
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

// The focused text field or editor, as an expression usable in waits.
const focusedEditable = `(() => {
	const el = document.activeElement;
	if (!el || el === document.body) return null;
	if (el.matches("input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea")) return el;
	return el.isContentEditable ? el : null;
})()`;

async function insertText(text) {
	await waitFor(`Boolean(${focusedEditable})`, "a focused input or editor to insert into");
	await send("Input.insertText", { text });
	// The inserted text must reach the field; Vim normal mode, a read-only
	// editor, or a focus change would otherwise drop it silently.
	const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
	await waitFor(`(() => {
		const el = ${focusedEditable};
		const value = el ? ("value" in el ? el.value : el.innerText) : "";
		return ${JSON.stringify(lines)}.every((line) => value.includes(line));
	})()`, `inserted text ${JSON.stringify(text)} in the focused field`);
	// svelte-codemirror-editor copies edits into the bound store only after a
	// 300 ms debounce (node_modules/svelte-codemirror-editor CodeMirror.svelte),
	// and nothing in the page signals the commit. A shortcut sent sooner runs
	// the store's old code, so this is the one fixed wait the driver keeps.
	if (await evaluate(`Boolean(document.activeElement?.closest(".cm-editor"))`)) await sleep(codeMirrorCommitMs);
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

const onRoute = (route) => `location.pathname === ${JSON.stringify(route.path)} && document.body.innerText.includes(${JSON.stringify(route.expected)})`;

async function driveRoute(route) {
	await capture(`${feature}-before`);
	const point = await clickTarget({ selector: route.selector });
	fs.writeFileSync(`${evidenceDir}/${feature}-action.txt`, `input=left mouse click\nselector=${route.selector}\nclick=${JSON.stringify(point)}\nexpected_path=${route.path}\nexpected_text=${route.expected}\n`);
	await waitFor(onRoute(route), `${feature} route and text`);
	await capture(`${feature}-after`);
	fs.writeFileSync(`${evidenceDir}/${feature}-console.json`, `${JSON.stringify(consoleEvents, null, 2)}\n`);
	fs.writeFileSync(`${evidenceDir}/${feature}-network.json`, `${JSON.stringify(networkEvents, null, 2)}\n`);
	console.log(`feature=${feature}\nresult=path ${route.path}, visible text: ${route.expected}\nevidence=${evidenceDir}`);
}

// Overlays fill in after they paint: the Project modal shows "No recent
// projects" until GetRecentProjects resolves. Wait until the page or overlay
// text stops changing for `quietMs`, so the capture shows loaded content.
async function waitForSettledText(description, quietMs = 500, timeoutMs = defaultTimeoutMs) {
	const deadline = Date.now() + timeoutMs;
	let last;
	let since = Date.now();
	while (true) {
		const text = await evaluate(`(document.querySelector("dialog[open], [data-testid='modal-component']") || document.body).innerText`);
		if (text !== last) {
			last = text;
			since = Date.now();
		} else if (Date.now() - since >= quietMs) {
			return;
		}
		if (Date.now() >= deadline) throw new Error(`timed out after ${timeoutMs} ms waiting for ${description} to stop changing`);
		await sleep(pollMs);
	}
}

async function driveCompare(route) {
	if (!label || !shortcut) throw new Error("compare requires a visible label and a MarasiKeys shortcut");
	await waitFor(onRoute(route), `${feature} route`);
	try {
		await compareClickAndShortcut(route);
	} finally {
		// Never leave an overlay behind for the next drive, pass or fail.
		if (await evaluate(overlayPainted)) {
			await pressEscape();
			await waitFor(`!${overlayPainted}`, "overlay closed after compare");
		}
	}
}

async function compareClickAndShortcut(route) {
	const name = slug(label);
	const control = { text: label };

	await capture(`${name}-click-before`);
	const point = await clickTarget(control);
	fs.writeFileSync(`${evidenceDir}/${name}-click-action.txt`, `input=left mouse click\ncontrol=actionable "${label}"\nclick=${JSON.stringify(point)}\n`);
	await waitFor(`${overlayPainted} || location.pathname !== ${JSON.stringify(route.path)}`, `click of "${label}" changed the page or painted an overlay`);
	await waitForSettledText(`the result of clicking "${label}"`);
	const clickAfter = await capture(`${name}-click-after`);
	const clickResult = resultOf(clickAfter);

	if (clickResult.kind === "overlay") {
		await pressEscape();
		await waitFor(`!${overlayPainted}`, "overlay closed");
	} else if (clickResult.path !== route.path) {
		await clickTarget({ selector: route.selector });
		await waitFor(onRoute(route), `return to ${feature}`);
	}
	// The shortcut must find the same starting page the click did.
	await waitForTarget(control);

	await capture(`${name}-shortcut-before`);
	fs.writeFileSync(
		`${evidenceDir}/${name}-shortcut-action.txt`,
		`input=keyboard shortcut through Chrome CDP Input.dispatchKeyEvent\nshortcut=${shortcut}\nbinding=MarasiKeys\nexpected=same result as clicking "${label}"\n`,
	);
	await pressShortcut(shortcut);
	await waitFor(`${overlayPainted} || location.pathname !== ${JSON.stringify(route.path)}`, `shortcut ${shortcut} changed the page or painted an overlay`);
	await waitForSettledText(`the result of ${shortcut}`);
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

async function driveTheme(route) {
	await waitFor(onRoute(route), "dashboard route");
	await clickTarget({ selector: routes.settings.selector });
	await waitFor(onRoute(routes.settings), "settings route");

	const initialDark = await evaluate(`document.documentElement.classList.contains("dark")`);
	await capture("theme-before");
	fs.writeFileSync(`${evidenceDir}/theme-action.txt`, "input=Command+U twice after leaving dashboard\nexpected=theme changes and returns to its initial value\n");
	await pressShortcut("cmd+u");
	await waitFor(`document.documentElement.classList.contains("dark") !== ${initialDark}`, "theme change");
	await capture("theme-toggled");
	await pressShortcut("cmd+u");
	await waitFor(`document.documentElement.classList.contains("dark") === ${initialDark}`, "theme restoration");
	await capture("theme-restored");
	fs.writeFileSync(`${evidenceDir}/theme-result.json`, `${JSON.stringify({ initialDark, toggledDark: !initialDark, restoredDark: initialDark }, null, 2)}\n`);
	console.log(`feature=${feature}\naction=theme\nresult=Command+U changed and restored theme after leaving dashboard\nevidence=${evidenceDir}`);
}

// A visible element matching a CSS selector, as a wait expression.
const paintedSelector = (selector) => `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).some((el) => {
	const box = el.getBoundingClientRect();
	return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== "hidden";
})`;

function stepTimeout(step) {
	if (step.timeoutMs === undefined) return defaultTimeoutMs;
	if (!Number.isInteger(step.timeoutMs) || step.timeoutMs < 1 || step.timeoutMs > 60000) throw new Error(`timeoutMs must be 1-60000: ${JSON.stringify(step)}`);
	return step.timeoutMs;
}

async function runStep(step) {
	const timeoutMs = stepTimeout(step);
	const scope = {
		...(step.within ? { within: step.within } : {}),
		...(step.hasText ? { hasText: step.hasText } : {}),
	};
	if (step.click || step.text) {
		const spec = step.click ? { selector: step.click, ...scope } : { text: step.text, ...scope };
		const button = step.button || "left";
		if (!["left", "right"].includes(button)) throw new Error(`button must be left or right: ${JSON.stringify(step)}`);
		return { click: await clickTarget(spec, { timeoutMs, nth: step.nth, button }) };
	}
	if (step.key) return void await pressShortcut(step.key);
	if (typeof step.insert === "string") return void await insertText(step.insert);
	// Scoped text waits read only the `within` roots, so text the page already
	// shows elsewhere (an editor holding the same token) cannot satisfy them.
	const visibleText = step.within
		? `Array.from(document.querySelectorAll(${JSON.stringify(step.within)})).map((el) => el.innerText).join("\\n")`
		: "document.body.innerText";
	const where = step.within ? ` within ${step.within}` : "";
	if (typeof step.waitText === "string") return void await waitFor(`${visibleText}.includes(${JSON.stringify(step.waitText)})`, `text ${JSON.stringify(step.waitText)}${where}`, timeoutMs);
	if (typeof step.waitNoText === "string") return void await waitFor(`!${visibleText}.includes(${JSON.stringify(step.waitNoText)})`, `absence of ${JSON.stringify(step.waitNoText)}${where}`, timeoutMs);
	if (typeof step.waitEnabledText === "string") return void await waitForTarget({ text: step.waitEnabledText, ...scope }, { timeoutMs, nth: step.nth });
	if (typeof step.waitSelector === "string") return void await waitFor(paintedSelector(step.waitSelector), `visible ${step.waitSelector}`, timeoutMs);
	if (typeof step.waitNoSelector === "string") return void await waitFor(`!(${paintedSelector(step.waitNoSelector)})`, `no visible ${step.waitNoSelector}`, timeoutMs);
	if (typeof step.waitPath === "string") return void await waitFor(`location.pathname === ${JSON.stringify(step.waitPath)}`, `path ${step.waitPath}`, timeoutMs);
	throw new Error(`unsupported UI step: ${JSON.stringify(step)}`);
}

async function driveSteps(route) {
	const recipe = JSON.parse(label);
	if (!recipe.name || !Array.isArray(recipe.steps) || !recipe.steps.length) throw new Error("steps requires {name, steps: [...]}");
	await waitFor(onRoute(route), `${feature} route`);
	const prefix = `${feature}-${slug(recipe.name)}`;
	fs.writeFileSync(`${evidenceDir}/${prefix}-action.json`, `${JSON.stringify(recipe, null, 2)}\n`);
	await capture(`${prefix}-before`);
	const log = [];
	try {
		for (const [index, step] of recipe.steps.entries()) {
			const started = Date.now();
			try {
				const detail = await runStep(step);
				log.push({ step: index + 1, ...step, ...detail, ms: Date.now() - started, result: "passed" });
			} catch (error) {
				log.push({ step: index + 1, ...step, ms: Date.now() - started, result: "failed", error: error.message });
				throw new Error(`step ${index + 1} ${JSON.stringify(step)} failed: ${error.message}`);
			}
			await capture(`${prefix}-step-${index + 1}`);
		}
		console.log(`feature=${feature}\naction=steps\nrecipe=${recipe.name}\nresult=passed\nevidence=${evidenceDir}`);
	} finally {
		fs.writeFileSync(`${evidenceDir}/${prefix}-steps.json`, `${JSON.stringify(log, null, 2)}\n`);
		await capture(`${prefix}-after`);
		fs.writeFileSync(`${evidenceDir}/${prefix}-console.json`, `${JSON.stringify(consoleEvents, null, 2)}\n`);
		fs.writeFileSync(`${evidenceDir}/${prefix}-network.json`, `${JSON.stringify(networkEvents, null, 2)}\n`);
		socket.close();
	}
}

// Size the real window so the page itself is the verification viewport.
// An Emulation override would end with each CDP session, letting the page
// relayout at Chrome's smaller default between drives.
async function sizeWindow() {
	const { windowId, bounds } = await send("Browser.getWindowForTarget");
	const [width, height] = await evaluate("[innerWidth, innerHeight]");
	await send("Browser.setWindowBounds", { windowId, bounds: { width: bounds.width + viewport.width - width, height: bounds.height + viewport.height - height } });
	await waitFor(viewportMatches, `${viewport.width}x${viewport.height} viewport at device scale 1`);
}

await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");
await send("Network.enable");

if (mode === "launch") {
	await sizeWindow();
	// Fulfilled documents lose Chrome's loopback classification. Keep access
	// limited to this isolated browser's Wails origin, not all websites.
	await send("Browser.setPermission", { permission: { name: "loopback-network" }, setting: "granted", origin: appOrigin });
	let interceptionError;
	let intercepted = false;
	let listenerStartupIntercepted = false;
	const normalizeStartup = async ({ data }) => {
		const message = JSON.parse(data);
		if (message.method !== "Fetch.requestPaused") return;
		const request = message.params;
		try {
			// Vite also serves the layout's CSS as a JavaScript import.
			if (new URL(request.request.url).searchParams.get("type") === "style") {
				await send("Fetch.continueRequest", { requestId: request.requestId });
				return;
			}
			const isRoot = request.resourceType === "Document";
			if (request.responseStatusCode !== 200) throw new Error(`Startup response returned ${request.responseStatusCode}`);
			const response = await send("Fetch.getResponseBody", { requestId: request.requestId });
			const original = response.base64Encoded ? Buffer.from(response.body, "base64").toString("utf8") : response.body;
			const { body, counts } = isRoot ? deduplicateBridgeHTML(original) : normalizeListenerStartup(original);
			if (isRoot) {
				fs.writeFileSync(`${evidenceDir}/launch-bridge.json`, `${JSON.stringify({ url: request.request.url, originalScriptCounts: counts, removedDuplicateScripts: Object.values(counts).reduce((sum, count) => sum + count - 1, 0) }, null, 2)}\n`);
			} else {
				fs.writeFileSync(`${evidenceDir}/launch-listener-startup.json`, `${JSON.stringify({ url: request.request.url, normalizedStartupCalls: 1 }, null, 2)}\n`);
			}
			const prefix = isRoot ? "launch-root" : "launch-layout";
			const extension = isRoot ? "html" : "js";
			fs.writeFileSync(`${evidenceDir}/${prefix}-original.${extension}`, original);
			fs.writeFileSync(`${evidenceDir}/${prefix}-normalized.${extension}`, body);
			await send("Fetch.fulfillRequest", {
				requestId: request.requestId,
				responseCode: request.responseStatusCode,
				responseHeaders: request.responseHeaders.filter(({ name }) => !["content-length", "content-encoding", "transfer-encoding"].includes(name.toLowerCase())),
				body: Buffer.from(body).toString("base64"),
			});
			if (isRoot) intercepted = true;
			else listenerStartupIntercepted = true;
		} catch (error) {
			interceptionError = error;
			await send("Fetch.failRequest", { requestId: request.requestId, errorReason: "Failed" });
		}
	};
	socket.addEventListener("message", normalizeStartup);
	await send("Fetch.enable", { patterns: [
		{ urlPattern: new URL(appURL).href, resourceType: "Document", requestStage: "Response" },
		{ urlPattern: `${appOrigin}/src/routes/+layout.svelte*`, resourceType: "Script", requestStage: "Response" },
	] });
	try {
		await send("Page.navigate", { url: appURL });
		// The first Vite compile of the app can take a minute or more.
		const deadline = Date.now() + 120000;
		while (true) {
			if (interceptionError) throw interceptionError;
			try {
				if (intercepted && listenerStartupIntercepted && await evaluate(`document.body?.innerText.includes("Project Dashboard")`)) break;
			} catch {
				// The document is still being replaced.
			}
			if (Date.now() >= deadline) throw new Error("timed out waiting for normalized Home startup");
			await sleep(pollMs);
		}
		await waitFor(`Array.from(document.querySelectorAll("button")).some(button => button.querySelector("span.bg-success-500"))`, "online Home listener indicator");
		await capture("launch-ready");
		await waitFor(`["/wails/ipc.js", "/wails/runtime.js"].every(path => Array.from(document.scripts).filter(script => script.src === location.origin + path).length === 1)`, "one copy of each Wails bridge script", 5000);
	} catch (error) {
		await capture("launch-failed");
		throw error;
	} finally {
		fs.writeFileSync(`${evidenceDir}/launch-console.json`, `${JSON.stringify(consoleEvents, null, 2)}\n`);
		fs.writeFileSync(`${evidenceDir}/launch-network.json`, `${JSON.stringify(networkEvents, null, 2)}\n`);
		await send("Fetch.disable");
		socket.removeEventListener("message", normalizeStartup);
	}
} else if (mode === "doctor") {
	await waitFor(`location.origin === ${JSON.stringify(appOrigin)} && window.go?.main?.App && window.runtime && ${viewportMatches} && document.querySelector('[title="Home"]')`, `healthy Marasi browser page, Wails bridge, app rail, and ${viewport.width}x${viewport.height} viewport`, 5000);
	await waitFor(`["/wails/ipc.js", "/wails/runtime.js"].every(path => Array.from(document.scripts).filter(script => script.src === location.origin + path).length === 1)`, "one copy of each Wails bridge script (relaunch after a full reload)", 5000);
	await waitFor(`!${overlayPainted} && !(${paintedSelector(".drawer")})`, "no open modal, command palette, or drawer left by an earlier drive (dismiss it or relaunch)", 2000);
} else if (mode === "reset") {
	// Dismiss what an earlier drive left open with the same input a user
	// would: Escape, then a click on the drawer backdrop.
	const residue = `${overlayPainted} || ${paintedSelector(".drawer")}`;
	for (let attempt = 0; attempt < 3 && await evaluate(residue); attempt++) {
		await pressEscape();
		try {
			await waitFor(`!(${residue})`, "residue dismissed by Escape", 2000);
		} catch {
			if (await evaluate(paintedSelector(".drawer-backdrop"))) {
				await clickPoint({ x: 5, y: 5 });
				await waitFor(`!(${paintedSelector(".drawer")})`, "drawer dismissed by a backdrop click", 2000).catch(() => {});
			}
		}
	}
	if (await evaluate(residue)) {
		await capture("reset-failed");
		throw new Error("an overlay or drawer is still open after reset; run cleanup.sh and relaunch");
	}
	console.log("reset=clean");
} else if (mode === "drive") {
	const route = routes[feature];
	if (!route) throw new Error(`unknown feature: ${feature}`);
	if (action === "compare") await driveCompare(route);
	else if (action === "steps") await driveSteps(route);
	else if (action === "theme") await driveTheme(route);
	else if (action) throw new Error(`unknown action: ${action}`);
	else await driveRoute(route);
} else {
	throw new Error(`unknown mode: ${mode}`);
}

socket.close();
