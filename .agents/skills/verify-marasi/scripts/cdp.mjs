#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { collectExpression, dropPoint, pickTarget, sameBox } from "./targets.mjs";

const [mode, portText, appURL, evidenceDir, widthText, heightText, feature, action, label, shortcut] = process.argv.slice(2);
const port = Number(portText);
const viewport = { width: Number(widthText), height: Number(heightText) };
const pollMs = 100;
const defaultTimeoutMs = 10000;
const codeMirrorCommitMs = 350;
if (!mode || !Number.isInteger(port) || !appURL || !evidenceDir || !Number.isInteger(viewport.width) || !Number.isInteger(viewport.height)) {
	throw new Error("usage: cdp.mjs <launch|electron|doctor|reset|drive> <cdp-port> <app-url> <evidence-dir> <width> <height> [instance (launch) | feature [compare <label> <shortcut>|steps <json>|shots|theme]]");
}

// `expected` must be text only the destination page paints. Rail labels are
// always visible, so a bare feature name proves nothing.
// A route with `shortcut` is reached by that key instead of a click, and
// `leave` steps take the page back to Home afterwards.
const routes = {
	home: { selector: '[title="Home"]', path: "/", expected: "Project Dashboard" },
	// Disconnect (⌘⇧⌫, `global.disconnect`) reloads the page onto the
	// connection screen; Connect takes the window back to Home.
	connection: {
		shortcut: "cmd+shift+backspace",
		path: "/",
		expected: "Connect to Marasi",
		leave: [{ text: "Connect to default" }, { waitText: "Project Dashboard" }],
	},
	ledger: { selector: '[title="Ledger"]', path: "/ledger", expected: "Saved queries" },
	compass: { selector: '[title="Compass"]', path: "/compass", expected: "Compass Settings" },
	// The rail icon's title gains " · N intercepted" while items are held.
	// "Intercepted" is the dock's header, or its strip label when collapsed.
	checkpoint: { selector: '[title="Checkpoint"], [title^="Checkpoint · "]', path: "/checkpoint", expected: "Intercepted" },
	launchpad: { selector: '[title="Launchpad"]', path: "/launchpad", expected: "Group by status" },
	// "Templates" is the dock's header, or its strip label when collapsed.
	armory: { selector: '[title="Armory"]', path: "/armory", expected: "Templates" },
	logbook: { selector: '[title="Logbook"]', path: "/logbook", expected: "In progress" },
	workshop: { selector: '[title="Workshop"]', path: "/workshop", expected: "Workshop Settings" },
	settings: { selector: '[title="Settings"]', path: "/settings", expected: "Marasi Settings" },
};

// Drawers an earlier drive can leave open: Skeleton's, and the Armory
// page's own, which sits inside the page and has no backdrop.
const openDrawers = ".drawer, .armory-drawer-box";

// Skeleton's modal wrapper is display: contents, so measure its card. The
// built-in confirm, alert and prompt dialogs carry data-testid="modal" on the
// card itself, and a one-line confirm is about 130 px tall. The Marasi menu
// is an open native <dialog>; measure the dialog itself, because its first
// child is the 48 px search input, and a filtered menu stays under 100 px
// tall.
const overlayPainted = `Boolean((() => {
	const menu = Array.from(document.querySelectorAll("dialog[open]")).some((dialog) => {
		const box = dialog.getBoundingClientRect();
		return box.width > 100 && box.height > 40;
	});
	if (menu) return true;
	const builtIn = document.querySelector("[data-testid='modal']")?.getBoundingClientRect();
	if (builtIn && builtIn.width > 100 && builtIn.height > 60) return true;
	const overlay = document.querySelector("[data-testid='modal-component']");
	const card = overlay?.querySelector(".modal-example-form") || overlay?.firstElementChild || overlay;
	const box = card?.getBoundingClientRect();
	return Boolean(box && box.width > 100 && box.height > 100);
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
		const overlay = document.querySelector("dialog[open], [data-testid='modal'], [data-testid='modal-component']");
		const card = overlay?.matches("[data-testid='modal']") ? overlay : overlay?.querySelector(".modal-example-form") || overlay?.firstElementChild || overlay;
		const rect = card?.getBoundingClientRect?.();
		return {
			url: location.href,
			path: location.pathname,
			title: document.title,
			viewport: {width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio},
			dark: document.documentElement.classList.contains("dark"),
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

// CDP modifier bits for a click held with keys down.
const MODIFIER_BITS = { alt: 1, ctrl: 2, meta: 4, shift: 8 };

// clicks 2 is a double-click: two press/release pairs, the second with
// clickCount 2, so the page sees click, click, dblclick. `modifiers` is
// CDP's bitmask (see clickModifiers).
async function clickPoint(point, button = "left", clicks = 1, modifiers = 0) {
	await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, modifiers });
	for (let clickCount = 1; clickCount <= clicks; clickCount += 1) {
		await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button, clickCount, modifiers });
		await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button, clickCount, modifiers });
	}
}

// `edge` clicks near the target's top or bottom edge instead of its centre,
// for a modal backdrop whose centre the modal covers.
async function clickTarget(spec, options = {}) {
	const point = dropPoint(await waitForTarget(spec, options), options.edge);
	await clickPoint(point, options.button, options.clicks, options.modifiers);
	return point;
}

// ["cmd", "shift"] as CDP's bitmask; cmd is Meta on macOS, Ctrl elsewhere.
function clickModifiers(names = []) {
	let bits = 0;
	for (const name of names) {
		const key = name === "cmd" ? (PRIMARY_IS_CTRL ? "ctrl" : "meta") : name;
		if (!(key in MODIFIER_BITS)) throw new Error(`unknown modifier ${name}: use cmd, shift, alt, ctrl or meta`);
		bits |= MODIFIER_BITS[key];
	}
	return bits;
}

// Where a drag holding the button is (`hold`), until a release step.
let held = null;

// Press on one match, move onto another with the button held, release there.
// `edge` lands near the target's top or bottom edge instead of its centre;
// `hold` keeps the button down so the next steps see the drag in progress.
async function dragTarget(from, to, { timeoutMs, edge, hold = false } = {}) {
	if (held) throw new Error("a drag is already held; release it first");
	const start = await waitForTarget(from, { timeoutMs });
	const end = dropPoint(await waitForTarget(to, { timeoutMs }), edge);
	await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: start.x, y: start.y });
	await send("Input.dispatchMouseEvent", { type: "mousePressed", x: start.x, y: start.y, button: "left", buttons: 1, clickCount: 1 });
	const steps = 4;
	for (let i = 1; i <= steps; i += 1) {
		const x = start.x + ((end.x - start.x) * i) / steps;
		const y = start.y + ((end.y - start.y) * i) / steps;
		await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
	}
	if (hold) {
		held = end;
		return { from: start, to: end, held: true };
	}
	await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: end.x, y: end.y, button: "left", buttons: 0, clickCount: 1 });
	return { from: start, to: end };
}

// Releases a held drag where it stopped.
async function releaseDrag() {
	if (!held) throw new Error("release needs a drag step with hold first");
	const point = held;
	held = null;
	await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 });
	return { release: point };
}

// Recipes write cmd+/⌘ for the primary modifier. On macOS that is Meta; on
// Linux/Windows the app's factory defaults bind Ctrl (DesktopOS !== darwin).
const PRIMARY_IS_CTRL = process.platform !== "darwin";

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
	const primary = parts.includes("cmd") || parts.includes("command");
	const explicitMeta = parts.includes("meta");
	const explicitCtrl = parts.includes("ctrl") || parts.includes("control");
	return {
		meta: explicitMeta || (primary && !PRIMARY_IS_CTRL),
		shift: parts.includes("shift"),
		ctrl: explicitCtrl || (primary && PRIMARY_IS_CTRL),
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
		"=": { key: "=", code: "Equal", keyCode: 187 },
		"-": { key: "-", code: "Minus", keyCode: 189 },
		"[": { key: "[", code: "BracketLeft", keyCode: 219 },
		"]": { key: "]", code: "BracketRight", keyCode: 221 },
		"\\": { key: "\\", code: "Backslash", keyCode: 220 },
		up: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
		down: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
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
	// A bare character types itself, so a focused <select> can jump to it.
	const typed = event.key.length === 1 && !parsed.meta && !parsed.ctrl && !parsed.alt
		? (parsed.shift ? event.key.toUpperCase() : event.key)
		: null;
	if (typed) {
		await pressKey("keyDown", typed, event.code, event.keyCode, modifiers, { text: typed, unmodifiedText: event.key });
	} else await pressKey("rawKeyDown", event.key, event.code, event.keyCode, modifiers, {
		text: "", unmodifiedText: "",
		...((parsed.meta || parsed.ctrl) && parsed.key === "a" ? {commands: ["selectAll"]} : {}),
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

// Reaches `route` with the input a user would, and returns that input.
async function enterRoute(route) {
	if (route.shortcut) {
		await pressShortcut(route.shortcut);
		await waitFor(onRoute(route), `${feature} route and text`);
		return `input=keyboard shortcut\nshortcut=${route.shortcut}\n`;
	}
	const point = await clickTarget({ selector: route.selector });
	await waitFor(onRoute(route), `${feature} route and text`);
	return `input=left mouse click\nselector=${route.selector}\nclick=${JSON.stringify(point)}\n`;
}

// Takes the page back to Home from a route that left it, as the connection
// screen does.
async function leaveRoute(route, prefix) {
	if (!route.leave) return;
	for (const step of route.leave) await runStep(step);
	await capture(`${prefix}-left`);
}

async function driveRoute(route) {
	await capture(`${feature}-before`);
	const input = await enterRoute(route);
	fs.writeFileSync(`${evidenceDir}/${feature}-action.txt`, `${input}expected_path=${route.path}\nexpected_text=${route.expected}\n`);
	await capture(`${feature}-after`);
	await leaveRoute(route, feature);
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
		const text = await evaluate(`(document.querySelector("dialog[open], [data-testid='modal'], [data-testid='modal-component']") || document.body).innerText`);
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
	// Theme may run after another drive left a different route; return to Home first.
	if (!(await evaluate(onRoute(route)))) {
		await clickTarget({ selector: route.selector });
	}
	await waitFor(onRoute(route), "Home route");
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

const isDark = `document.documentElement.classList.contains("dark")`;
const onConnectionScreen = `document.body.innerText.includes("Connect to Marasi")`;

// Switches the appearance with ⌘U, as a user would, until it is `dark`.
async function setAppearance(dark) {
	if ((await evaluate(isDark)) === dark) return;
	await pressShortcut("cmd+u");
	await waitFor(`${isDark} === ${dark}`, `${dark ? "dark" : "light"} appearance`);
}

// Screenshots of the route in light and in dark. A connected page switches
// with ⌘U, as a user would, and is left as it started. The connection
// screen has no shortcuts and its window reloads into it, taking the OS
// appearance (the layout's autoModeWatcher), so it is shot under an
// emulated OS preference instead, which lasts through the reload and ends
// before this returns.
async function driveShots(route) {
	const initialDark = await evaluate(isDark);
	const shots = {};
	try {
		for (const dark of [initialDark, !initialDark]) {
			const mode = dark ? "dark" : "light";
			if (route.leave) {
				await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: mode }] });
				await enterRoute(route);
			} else {
				if (!(await evaluate(onRoute(route)).catch(() => false))) await enterRoute(route);
				await setAppearance(dark);
			}
			await waitFor(`${isDark} === ${dark}`, `${feature} in ${mode}`);
			await waitForSettledText(`${feature} in ${mode}`);
			const state = await capture(`${feature}-${mode}`);
			shots[mode] = { png: `${feature}-${mode}.png`, dark: state.dark, path: state.path };
			await leaveRoute(route, `${feature}-${mode}`);
		}
	} finally {
		if (route.leave) await send("Emulation.setEmulatedMedia", { features: [] });
		// A failure on the connection screen leaves it there; reset.sh
		// connects again.
		else if (!(await evaluate(onConnectionScreen))) await setAppearance(initialDark);
	}
	fs.writeFileSync(`${evidenceDir}/${feature}-shots.json`, `${JSON.stringify({ initialDark, ...shots }, null, 2)}\n`);
	console.log(`feature=${feature}\naction=shots\nlight=${evidenceDir}/${feature}-light.png\ndark=${evidenceDir}/${feature}-dark.png`);
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
		const clicks = step.clickCount ?? 1;
		if (![1, 2].includes(clicks)) throw new Error(`clickCount must be 1 or 2: ${JSON.stringify(step)}`);
		const modifiers = clickModifiers(step.modifiers);
		return { click: await clickTarget(spec, { timeoutMs, nth: step.nth, button, clicks, modifiers, edge: step.edge }) };
	}
	if (step.drag) {
		const from = { selector: step.drag, ...scope };
		const to = { selector: step.to ?? step.drag, ...(step.within ? { within: step.within } : {}), ...(step.toHasText ? { hasText: step.toHasText } : {}) };
		if (step.hold !== undefined && typeof step.hold !== "boolean") throw new Error(`hold must be true or false: ${JSON.stringify(step)}`);
		return { drag: await dragTarget(from, to, { timeoutMs, edge: step.toEdge, hold: step.hold }) };
	}
	if (step.release === true) return releaseDrag();
	if (step.hover) {
		// A real pointer move onto the one actionable match, for controls that
		// only show on hover. The pointer stays there until the next click.
		// A disabled control is hoverable too (its tooltip, or its box: the
		// recorded point shows whether a toolbar control moved).
		const point = await waitForTarget({ selector: step.hover, ...scope }, { timeoutMs, nth: step.nth, enabled: false });
		await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
		return { hover: point };
	}
	if (step.wheel) {
		// A real wheel turn over the one actionable match, for scrolling a
		// container (sticky rows can cover the match the driver would click).
		if (!Number.isFinite(step.deltaY)) throw new Error(`wheel needs a numeric deltaY: ${JSON.stringify(step)}`);
		const point = await waitForTarget({ selector: step.wheel, ...scope }, { timeoutMs, nth: step.nth });
		// The hidden headless page may never ack a wheel event, so do not
		// wait for the reply; wait for the scrolled state in the next step.
		send("Input.dispatchMouseEvent", { type: "mouseWheel", x: point.x, y: point.y, deltaX: 0, deltaY: step.deltaY }).catch(() => {});
		return { wheel: point };
	}
	if (step.files) {
		// Hands files on this machine to a file input, as the native picker
		// it opens would (the driver can't answer that picker). The input
		// may be hidden behind its label, so it need only exist.
		if (!Array.isArray(step.paths) || !step.paths.length) throw new Error(`files needs a list of paths: ${JSON.stringify(step)}`);
		const paths = step.paths.map((file) => path.resolve(file));
		for (const file of paths) if (!fs.existsSync(file)) throw new Error(`no file ${file}`);
		const query = `document.querySelector(${JSON.stringify(step.files)})`;
		await waitFor(`!!${query}`, `file input ${step.files}`, timeoutMs);
		const { result } = await send("Runtime.evaluate", { expression: query });
		await send("DOM.setFileInputFiles", { files: paths, objectId: result.objectId });
		return { files: paths };
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
		// A recipe that stopped mid-drag cancels it (Esc) before letting go,
		// so the release drops nothing.
		if (held) {
			await pressEscape();
			await releaseDrag();
		}
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
// A browser extension can open its own tab in front of Marasi (a
// force-installed password manager's welcome page does). Chrome then stops
// painting the hidden page, so screenshots and drives stall for minutes.
await send("Page.bringToFront");

// The window's rail: the page is connected and drawing the app.
const railReady = `Boolean(document.querySelector('[title="Home"]')) && !(${onConnectionScreen})`;

if (mode === "launch") {
	// `feature` carries the instance name at launch.
	const instance = feature;
	await sizeWindow();
	try {
		await send("Page.navigate", { url: appURL });
		// The first Vite compile of the app can take a minute or more. The
		// dev server's bridge has no connection yet, so the page shows the
		// connection screen.
		await waitFor(`document.body?.innerText.includes("Connect to Marasi")`, "the connection screen", 120000);
		await waitForTarget({ text: `Connect to ${instance}` }, { timeoutMs: 30000 });
		await capture("launch-connection");
		const point = await clickTarget({ text: `Connect to ${instance}` });
		fs.writeFileSync(`${evidenceDir}/launch-action.txt`, `input=left mouse click\ncontrol=Connect to ${instance}\nclick=${JSON.stringify(point)}\nexpected=Project Dashboard\n`);
		await waitFor(`${railReady} && document.body.innerText.includes("Project Dashboard")`, "Home after connecting", 60000);
		await waitForSettledText("Home after connecting");
		await capture("launch-ready");
	} catch (error) {
		await capture("launch-failed");
		throw error;
	} finally {
		fs.writeFileSync(`${evidenceDir}/launch-console.json`, `${JSON.stringify(consoleEvents, null, 2)}\n`);
		fs.writeFileSync(`${evidenceDir}/launch-network.json`, `${JSON.stringify(networkEvents, null, 2)}\n`);
	}
} else if (mode === "electron") {
	// The app's own window, at its own size: it connects to the default
	// instance at launch.
	try {
		await waitFor(`${railReady} && document.body.innerText.includes("Project Dashboard")`, "Home in the Electron window", 120000);
		await waitForSettledText("Home in the Electron window");
		await capture("electron-ready");
	} catch (error) {
		await capture("electron-failed");
		throw error;
	}
} else if (mode === "doctor") {
	await waitFor(`location.origin === ${JSON.stringify(appOrigin)} && ${viewportMatches} && ${railReady}`, `a connected Marasi page with its app rail and a ${viewport.width}x${viewport.height} viewport (on the connection screen, connect again or relaunch)`, 5000);
	await waitFor(`document.visibilityState === "visible"`, "the Marasi page in front, not hidden behind another tab", 2000);
	await waitFor(`!${overlayPainted} && !(${paintedSelector(openDrawers)})`, "no open modal, command palette, or drawer left by an earlier drive (dismiss it or relaunch)", 2000);
} else if (mode === "reset") {
	// Dismiss what an earlier drive left open with the same input a user
	// would: Escape, then a click on the drawer backdrop.
	const residue = `${overlayPainted} || ${paintedSelector(openDrawers)}`;
	for (let attempt = 0; attempt < 3 && await evaluate(residue); attempt++) {
		await pressEscape();
		try {
			await waitFor(`!(${residue})`, "residue dismissed by Escape", 2000);
		} catch {
			// The Logbook's record modal asks before dropping unsaved input,
			// and Escape there only toggles the prompt: answer Discard.
			if (await evaluate(paintedSelector("[data-close-prompt]"))) {
				await clickTarget({ text: "Discard", within: "[data-close-prompt]" }, { timeoutMs: 2000 });
				await waitFor(`!(${residue})`, "residue dismissed by Discard", 2000).catch(() => {});
			} else if (await evaluate(paintedSelector(".drawer-backdrop"))) {
				await clickPoint({ x: 5, y: 5 });
				await waitFor(`!(${paintedSelector(openDrawers)})`, "drawer dismissed by a backdrop click", 2000).catch(() => {});
			}
		}
	}
	// A window an earlier drive left on the connection screen connects again.
	if (await evaluate(onConnectionScreen)) {
		await clickTarget({ text: "Connect to default" });
		await waitFor(railReady, "Home after connecting again", 30000);
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
	else if (action === "shots") await driveShots(route);
	else if (action) throw new Error(`unknown action: ${action}`);
	else await driveRoute(route);
} else {
	throw new Error(`unknown mode: ${mode}`);
}

socket.close();
