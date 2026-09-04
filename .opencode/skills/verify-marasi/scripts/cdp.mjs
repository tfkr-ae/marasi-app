#!/usr/bin/env node

import fs from "node:fs";

const [mode, portText, appURL, evidenceDir, widthText, heightText, feature] = process.argv.slice(2);
const port = Number(portText);
const viewport = { width: Number(widthText), height: Number(heightText) };
if (!mode || !Number.isInteger(port) || !appURL || !evidenceDir || !Number.isInteger(viewport.width) || !Number.isInteger(viewport.height)) {
	throw new Error("usage: cdp.mjs <launch|doctor|drive> <cdp-port> <app-url> <evidence-dir> <width> <height> [feature]");
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

async function waitFor(expression, description, attempts = 60) {
	for (let attempt = 0; attempt < attempts; attempt++) {
		if (await evaluate(expression)) return;
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	throw new Error(`timed out waiting for ${description}`);
}

async function capture(prefix) {
	const state = await evaluate(`({url: location.href, title: document.title, viewport: {width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio}, text: document.body.innerText, html: document.documentElement.outerHTML})`);
	fs.writeFileSync(`${evidenceDir}/${prefix}.json`, `${JSON.stringify(state, null, 2)}\n`);
	const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
	fs.writeFileSync(`${evidenceDir}/${prefix}.png`, screenshot.data, "base64");
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
	await capture(`${feature}-before`);
	fs.writeFileSync(`${evidenceDir}/${feature}-action.txt`, `input=left mouse click\nselector=${route.selector}\nexpected_path=${route.path}\nexpected_text=${route.expected}\n`);
	const point = await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(route.selector)}); if (!element) return null; const box = element.getBoundingClientRect(); return {x: box.left + box.width / 2, y: box.top + box.height / 2}; })()`);
	if (!point) throw new Error(`selector not found: ${route.selector}`);
	await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
	await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
	await waitFor(`location.pathname === ${JSON.stringify(route.path)} && document.body.innerText.includes(${JSON.stringify(route.expected)})`, `${feature} route and text`, 20);
	await capture(`${feature}-after`);
	fs.writeFileSync(`${evidenceDir}/${feature}-console.json`, `${JSON.stringify(consoleEvents, null, 2)}\n`);
	fs.writeFileSync(`${evidenceDir}/${feature}-network.json`, `${JSON.stringify(networkEvents, null, 2)}\n`);
	console.log(`feature=${feature}\nresult=path ${route.path}, visible text: ${route.expected}\nevidence=${evidenceDir}`);
} else {
	throw new Error(`unknown mode: ${mode}`);
}

socket.close();
