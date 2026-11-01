// The report templates the export modal picks from. The store follows the
// report.template.* events, so a template the CLI or another window adds,
// removes or restores shows up while the modal is open.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createReportTemplateStore } from "./createReportTemplateStore.js";

// A fake instance holding `names`; each change answers the new list.
function fakeApi(names) {
  const calls = [];
  return {
    calls,
    list: async () => [...names],
    upload: async (name, bytes) => (calls.push(["upload", name, bytes]), (names = [...names, name].sort())),
    remove: async (name) => (calls.push(["remove", name]), (names = names.filter((n) => n !== name))),
    restore: async () => (calls.push(["restore"]), (names = [...new Set([...names, "default_template.md"])].sort())),
  };
}

const event = (...names) => ({ items: names.map((name) => ({ name, size: 1 })) });

test("reload lists the templates and picks the first, as v1's export did", async () => {
  const store = createReportTemplateStore(fakeApi(["custom.md", "default_template.md"]));
  assert.equal(get(store).loaded, false);
  await store.reload();
  assert.deepEqual(get(store), { names: ["custom.md", "default_template.md"], selected: "custom.md", loaded: true });
});

test("a template another client adds joins the list and keeps the researcher's pick", async () => {
  const store = createReportTemplateStore(fakeApi(["custom.md", "default_template.md"]));
  await store.reload();
  store.select("default_template.md");
  store.onTemplates(event("a.md", "custom.md", "default_template.md"));
  assert.deepEqual(get(store).names, ["a.md", "custom.md", "default_template.md"]);
  assert.equal(get(store).selected, "default_template.md");
});

test("when another client removes the picked template, the first one left is picked", async () => {
  const store = createReportTemplateStore(fakeApi(["custom.md", "default_template.md"]));
  await store.reload();
  store.select("default_template.md");
  store.onTemplates(event("custom.md"));
  assert.equal(get(store).selected, "custom.md");
  store.onTemplates(event());
  assert.equal(get(store).selected, undefined);
});

test("an uploaded template is picked", async () => {
  const api = fakeApi(["default_template.md"]);
  const store = createReportTemplateStore(api);
  await store.reload();
  const bytes = new Uint8Array([35]);
  await store.upload("acme.md", bytes);
  assert.deepEqual(api.calls, [["upload", "acme.md", bytes]]);
  assert.deepEqual(get(store), { names: ["acme.md", "default_template.md"], selected: "acme.md", loaded: true });
});

test("deleting the picked template picks the first left, and restore brings the default back", async () => {
  const store = createReportTemplateStore(fakeApi(["default_template.md"]));
  await store.reload();
  await store.remove("default_template.md");
  assert.deepEqual(get(store), { names: [], selected: undefined, loaded: true });
  await store.restore();
  assert.deepEqual(get(store), { names: ["default_template.md"], selected: "default_template.md", loaded: true });
});

test("a refused change leaves the list as it was", async () => {
  const api = fakeApi(["default_template.md"]);
  api.upload = async () => {
    throw new Error("POST /report/template: report_template_already_exists");
  };
  const store = createReportTemplateStore(api);
  await store.reload();
  await assert.rejects(store.upload("default_template.md", new Uint8Array()), /already_exists/);
  assert.deepEqual(get(store).names, ["default_template.md"]);
});
