// Benchmarks the Ledger in the running verification instance and checks the
// results against its performance budget (features/ledger.md, "Performance
// budget"). Run it through bench-ledger.sh, after bench-seed.sh has filled
// the project. Every figure is the median of its runs, in milliseconds.
//
//   warmShell / warmRows  Home -> Ledger click until the toolbar / first row
//                         paints, with the Ledger's code already loaded.
//   firstVisit            Toolbar paint on the first visit after a fresh
//                         launch (bench-ledger.sh restarts the instance),
//                         when nothing has loaded the Ledger's code yet.
//   startupRows           First row on a Ledger click made the moment Home
//                         shows after an app reload, while the project is
//                         still opening (median of 3): what a researcher
//                         who opens the Ledger straight away waits.
//   longestTask           The longest main-thread task during a warm visit.
//   sortRows              A sort header click until the table shows the
//                         newly sorted first row (a full first-page read).
//   firstPage             QueryTraffic for the live view's first page alone.
//   count                 CountTraffic for the live view alone (the status
//                         bar's count; it grows with the project).
import fs from "node:fs";

const [port, outFile] = process.argv.slice(2);
if (!port || !outFile) {
	console.error("usage: bench-ledger.mjs <cdp-port> <out.json>");
	process.exit(2);
}

// The budget. Change it only with a reason in the commit that changes it.
const BUDGET = {
	warmShell: 100,
	warmRows: 100,
	firstVisit: 150,
	startupRows: 500,
	longestTask: 100,
	sortRows: 300,
	firstPage: 50,
};

const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
const target = targets.find((t) => t.type === "page");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
let nextId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
	const message = JSON.parse(event.data);
	if (message.id && pending.has(message.id)) {
		pending.get(message.id)(message);
		pending.delete(message.id);
	}
});
const send = (method, params = {}) =>
	new Promise((resolve) => {
		const id = ++nextId;
		pending.set(id, resolve);
		socket.send(JSON.stringify({ id, method, params }));
	});
// A call made while the page reloads can go unanswered; it fails after
// `timeoutMs` so `until` asks again.
async function evaluate(expression, timeoutMs = 30000) {
	const message = await Promise.race([
		send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }),
		new Promise((_, reject) => setTimeout(() => reject(new Error("no answer from the page")), timeoutMs)),
	]);
	if (message.result?.exceptionDetails) throw new Error(JSON.stringify(message.result.exceptionDetails).slice(0, 400));
	return message.result?.result?.value;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(expression, timeoutMs = 60000) {
	const deadline = Date.now() + timeoutMs;
	while (!(await evaluate(expression, 2000).catch(() => false))) {
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${expression}`);
		await sleep(50);
	}
}
const median = (values) => {
	const sorted = [...values].sort((a, b) => a - b);
	return Math.round(sorted[Math.floor(sorted.length / 2)]);
};

// In-page helpers: rail navigation and frame-accurate waits.
const helpers = `
	window.__bench ??= {
		go: (title) => document.querySelector('[title="' + title + '"]').click(),
		waitFor: (test) => new Promise((ok) => { const tick = () => (test() ? ok(performance.now()) : requestAnimationFrame(tick)); tick(); }),
	};`;

async function toHome() {
	await evaluate(`${helpers} __bench.go("Home")`);
	await until(`document.body.innerText.includes("Project Dashboard") && !document.querySelector(".ledger-toolbar")`);
	await sleep(400);
}

// A visit: Home -> Ledger, timing the shell, the first row and long tasks.
const visit = `new Promise(async (resolve) => {
	${helpers}
	let longest = 0;
	const observer = new PerformanceObserver((list) => { for (const entry of list.getEntries()) longest = Math.max(longest, entry.duration); });
	try { observer.observe({ type: "longtask" }); } catch {}
	const start = performance.now();
	__bench.go("Ledger");
	const shell = await __bench.waitFor(() => document.querySelector(".ledger-toolbar"));
	const rows = await __bench.waitFor(() => document.querySelector(".ledger-row"));
	await new Promise((r) => setTimeout(r, 200));
	observer.disconnect();
	resolve({ shell: shell - start, rows: rows - start, longestTask: longest });
})`;

const results = { first: null, startup: [], warm: [], sort: [], firstPage: [], count: [] };

// The first visit since launch, once Home has been idle for a moment.
await until(`Boolean(window.go?.main?.App && document.body?.innerText.includes("Project Dashboard"))`, 120000);
await sleep(4000);
results.first = await evaluate(visit);

// Startup visits: reload on Home and click Ledger as soon as Home shows.
for (let i = 0; i < 3; i++) {
	await toHome();
	await send("Page.reload", {});
	await until(`Boolean(window.go?.main?.App && document.body?.innerText.includes("Project Dashboard") && document.querySelector('[title="Ledger"]'))`, 120000);
	// Timed from here by polling: the page is still settling, and one long
	// call into it can go unanswered.
	const start = Date.now();
	await evaluate(`document.querySelector('[title="Ledger"]').click()`, 2000).catch(() => {});
	await until(`Boolean(document.querySelector(".ledger-row"))`, 60000);
	results.startup.push({ rows: Date.now() - start });
}

// Warm visits.
await evaluate(`${helpers} __bench.go("Ledger")`);
await until(`Boolean(document.querySelector(".ledger-row"))`);
for (let i = 0; i < 5; i++) {
	await toHome();
	results.warm.push(await evaluate(visit));
}

// Sorts: alternate Host and # and time until the first row changes.
await until(`Boolean(document.querySelector(".ledger-row"))`);
for (let i = 0; i < 6; i++) {
	const field = i % 2 === 0 ? "host" : "number";
	results.sort.push(
		await evaluate(`new Promise(async (resolve) => {
			${helpers}
			const first = () => document.querySelector(".ledger-row")?.dataset.row;
			const before = first();
			const start = performance.now();
			document.querySelector('[data-sort="${field}"]').click();
			const done = await __bench.waitFor(() => first() && first() !== before);
			resolve(done - start);
		})`),
	);
	await sleep(300);
}

// The two Marasi calls the Ledger waits on most, alone.
for (let i = 0; i < 5; i++) {
	const timing = await evaluate(`(async () => {
		const app = window.go.main.App;
		let start = performance.now();
		await app.QueryTraffic({ Query: "", OrderBy: "number desc", Cursor: "", Direction: "forward", AsOf: "", Limit: 200 });
		const firstPage = performance.now() - start;
		start = performance.now();
		await app.CountTraffic("", "", {});
		return { firstPage, count: performance.now() - start };
	})()`);
	results.firstPage.push(timing.firstPage);
	results.count.push(timing.count);
}

const pairs = await evaluate(`window.go.main.App.CountTraffic("", "", { IgnoreExclusion: true }).then((r) => r.Count)`);
const summary = {
	pairs,
	warmShell: median(results.warm.map((r) => r.shell)),
	warmRows: median(results.warm.map((r) => r.rows)),
	firstVisit: Math.round(results.first.shell),
	startupRows: median(results.startup.map((r) => r.rows)),
	longestTask: median(results.warm.map((r) => r.longestTask)),
	sortRows: median(results.sort),
	firstPage: median(results.firstPage),
	count: median(results.count),
};
const over = Object.entries(BUDGET).filter(([key, limit]) => summary[key] > limit);
fs.writeFileSync(outFile, `${JSON.stringify({ summary, budget: BUDGET, over: over.map(([k]) => k), runs: results }, null, 2)}\n`);
for (const [key, value] of Object.entries(summary)) {
	const limit = BUDGET[key];
	console.log(`${key.padEnd(12)} ${String(value).padStart(7)}${limit ? `  (budget ${limit}${value > limit ? ", OVER" : ""})` : ""}`);
}
socket.close();
process.exit(over.length ? 1 : 0);
