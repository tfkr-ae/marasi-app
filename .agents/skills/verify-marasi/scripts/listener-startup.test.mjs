import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { normalizeListenerStartup } from "./listener-startup.mjs";

const startup = `const StartupRoutine2 = new Promise(resolve => {
 SetupScratchpad().then(() => {
  StartProxy($marasiConfig.DefaultAddress, $marasiConfig.DefaultPort).then(() => {
   listener.set({status: true}); resolve();
  }).catch(() => {listener.set({status: false}); resolve();});
 });
});`;

async function run(startError, updateError) {
	const calls = [];
	let state;
	const context = {
		$marasiConfig: { DefaultAddress: "127.0.0.1", DefaultPort: "18080" },
		SetupScratchpad: async () => {},
		StartProxy: async (...args) => {
			calls.push(["start", ...args]);
			if (startError) throw startError;
		},
		window: { go: { main: { App: { UpdateProxy: async (...args) => {
			calls.push(["update", ...args]);
			if (updateError) throw updateError;
		} } } } },
		listener: { set: value => { state = value; } },
		console: { info() {} },
	};
	await vm.runInNewContext(normalizeListenerStartup(startup).body + "\nStartupRoutine2;", context);
	return { calls, online: state.status };
}

test("normal startup still calls the real StartProxy only", async () => {
	assert.deepEqual(await run(), { calls: [["start", "127.0.0.1", "18080"]], online: true });
});
test("second frontend validates the real active listener before becoming online", async () => {
	assert.deepEqual(await run("listener already active"), { calls: [["start", "127.0.0.1", "18080"], ["update", "127.0.0.1", "18080"]], online: true });
});
test("unrelated startup failures remain offline", async () => {
	assert.deepEqual(await run("bind failed"), { calls: [["start", "127.0.0.1", "18080"]], online: false });
});
test("failed listener reconciliation remains offline", async () => {
	assert.equal((await run("listener already active", "listener inactive")).online, false);
});
test("only the startup call changes, not interactive calls", () => {
	const interactive = "function startFromMenu() { return StartProxy(address, port); }";
	assert.ok(normalizeListenerStartup(startup + interactive).body.endsWith(interactive));
});
test("unexpected or repeated startup shapes fail closed", () => {
	assert.throws(() => normalizeListenerStartup("StartProxy(address, port)"), /startup/);
	assert.throws(() => normalizeListenerStartup(startup + startup), /startup/);
});
