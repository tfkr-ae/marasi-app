import assert from "node:assert/strict";
import test from "node:test";
import { deduplicateBridgeHTML } from "./bridge-html.mjs";

test("keeps the first bridge scripts and leaves the Home bootstrap unchanged", () => {
	const first = '<script src="/wails/ipc.js"></script><script src="/wails/runtime.js"></script>';
	const bootstrap = '<script type="module">startHome()</script><div>Project Dashboard</div>';
	const html = `<head>${first}<meta name="wails-options" content="noautoinject">${first}</head>${bootstrap}`;
	const result = deduplicateBridgeHTML(html);
	assert.equal(result.body, `<head>${first}<meta name="wails-options" content="noautoinject"></head>${bootstrap}`);
	assert.deepEqual(result.counts, { "/wails/ipc.js": 2, "/wails/runtime.js": 2 });
});

test("leaves an already single-bridge page unchanged", () => {
	const html = "<script src='/wails/runtime.js'></script><script src='/wails/ipc.js'></script>";
	assert.equal(deduplicateBridgeHTML(html).body, html);
});

test("does not remove other scripts or inline content", () => {
	const bridge = '<script src="/wails/ipc.js"></script><script src="/wails/runtime.js"></script>';
	const other = '<script src="/other.js"></script><script>console.log("/wails/ipc.js")</script>';
	assert.equal(deduplicateBridgeHTML(bridge + other + bridge).body, bridge + other);
});

test("fails on missing bridges instead of accepting an unexpected page", () => {
	assert.throws(() => deduplicateBridgeHTML("<html>Error</html>"), /missing/);
});
