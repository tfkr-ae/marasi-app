import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("./cdp.mjs", import.meta.url), "utf8");
const delay = source.match(/^const interactionDelayMs = \d+;$/m)?.[0];
assert.ok(delay, "shared interaction delay exists");

function definition(name) {
	const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
	assert.notEqual(start, -1, `${name} exists`);
	return source.slice(start, source.indexOf("\n}", start) + 2);
}

for (const [name, argument] of [
	["clickPoint", { x: 100, y: 100 }],
	["pressShortcut", "cmd+o"],
	["pressEscape", undefined],
]) {
	test(`${name} waits 500 ms after releasing input`, async () => {
		const events = [];
		let release;
		const context = {
			send: async (method, params) => { events.push({ method, ...params }); },
			sleep: ms => {
				events.push({ delay: ms });
				return new Promise(resolve => { release = resolve; });
			},
		};
		const helpers = ["clickPoint", "parseShortcut", "keyEvent", "pressKey", "pressShortcut", "pressEscape"].map(definition).join("\n");
		const run = vm.runInNewContext(`${delay}\n${helpers}\n${name}`, context);
		let finished = false;
		const action = run(argument).then(() => { finished = true; });
		while (!release) await new Promise(resolve => setImmediate(resolve));
		assert.equal(finished, false);
		assert.equal(events.at(-1).delay, 500);
		assert.equal(events.filter(event => "delay" in event).length, 1);
		assert.ok(["mouseReleased", "keyUp"].includes(events.at(-2).type));
		release();
		await action;
		assert.equal(finished, true);
	});
}
