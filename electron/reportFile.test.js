import { test } from "node:test";
import assert from "node:assert/strict";
import { createReportFile } from "./reportFile.js";

// A fake fs that records writes, and a save dialog that answers `chosen`.
function setup(chosen, env = {}) {
  const writes = [];
  const asked = [];
  const reportFile = createReportFile({
    fs: { writeFile: async (path, contents, options) => writes.push({ path, contents, options }) },
    dialog: { save: async (options) => (asked.push(options), chosen) },
    env,
    home: "/Users/r",
  });
  return { reportFile, writes, asked };
}

const bytes = new TextEncoder().encode("# Acme Report\n");

test("save writes the report where the researcher chose, offering its name in Downloads as v1 did", async () => {
  const { reportFile, writes, asked } = setup("/Users/r/Desktop/Acme Report.md");
  assert.equal(await reportFile.save("Acme Report.md", bytes), "/Users/r/Desktop/Acme Report.md");
  assert.equal(asked[0].title, "Save Report");
  assert.equal(asked[0].defaultPath, "/Users/r/Downloads/Acme Report.md");
  assert.deepEqual(writes, [{ path: "/Users/r/Desktop/Acme Report.md", contents: bytes, options: { mode: 0o600 } }]);
});

test("the offered name drops any directories a report title holds", async () => {
  const { reportFile, asked } = setup(null);
  await reportFile.save("Q1/Acme.md", bytes);
  assert.equal(asked[0].defaultPath, "/Users/r/Downloads/Acme.md");
});

test("a cancelled save writes nothing", async () => {
  const { reportFile, writes } = setup(null);
  assert.equal(await reportFile.save("Acme.md", bytes), "");
  assert.deepEqual(writes, []);
});

test("MARASI_REPORT_DIR saves under the report's name there without a dialog, for headless verification", async () => {
  const { reportFile, writes, asked } = setup(null, { MARASI_REPORT_DIR: "/tmp/reports" });
  assert.equal(await reportFile.save("Acme.md", bytes), "/tmp/reports/Acme.md");
  assert.deepEqual(asked, []);
  assert.equal(writes[0].path, "/tmp/reports/Acme.md");
});

test("save refuses anything that isn't bytes", async () => {
  const { reportFile, writes } = setup("/tmp/x");
  await assert.rejects(reportFile.save("x.md", "text"), /bytes/);
  assert.deepEqual(writes, []);
});
