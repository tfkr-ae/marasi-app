// The report bindings: templates and export. Each sends its control API
// route; an export saves the rendered bytes on this machine.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as App from "./App.js";
import { useConnection } from "./marasi.js";

let sent;
let answers;
let saved;
const realFetch = globalThis.fetch;
const realTZ = process.env.TZ;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const rendered = new TextEncoder().encode("# Acme Report\n");

// The connected instance answers each route from `answers`, by "METHOD path";
// the window's bridge records the reports it saves, and `saveAs` is where.
let saveAs;
beforeEach(() => {
  sent = [];
  answers = {};
  saved = [];
  saveAs = "/Users/r/Downloads/Acme Report.md";
  process.env.TZ = "Asia/Kathmandu";
  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    const method = init.method ?? "GET";
    const type = init.headers?.["Content-Type"];
    const body =
      init.body === undefined ? undefined : type === "application/json" ? JSON.parse(init.body) : init.body;
    sent.push({ method, path: parsed.pathname, search: parsed.search, type, body });
    const answer = answers[`${method} ${parsed.pathname}`];
    if (answer === undefined) return json({ error: "not_found" }, 404);
    return typeof answer === "function" ? answer() : json(answer);
  };
  globalThis.window = {
    marasiApp: { saveReport: async (filename, bytes) => (saved.push({ filename, bytes }), saveAs) },
  };
  useConnection("http://127.0.0.1:50037");
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete globalThis.window;
  if (realTZ === undefined) delete process.env.TZ;
  else process.env.TZ = realTZ;
});

const templates = { items: [{ name: "custom.md", size: 12 }, { name: "default_template.md", size: 4096 }] };

// The export's details as the Logbook keeps them (stores.js reportMetadata).
const metadata = {
  title: "Acme Report",
  client: "Acme",
  type: "Web",
  is_draft: false,
  scope: "*.acme.test",
  assessor: "r",
  start: "2026-10-18",
  end: "2026-11-01",
  created_at: "2026-11-01T06:15:00.000Z",
  truncate_length: 1000,
  custom_properties: { include_test_cases: false, engagement: "Q4" },
};

test("ListTemplates lists the instance's templates by name, in Marasi's order", async () => {
  answers["GET /report/template"] = templates;
  assert.deepEqual(await App.ListTemplates(), ["custom.md", "default_template.md"]);
});

test("ExportReport renders the template with dates, created_at in this machine's zone and include_test_cases, then saves it", async () => {
  answers["POST /report"] = () => new Response(rendered, { headers: { "Content-Type": "application/octet-stream" } });
  assert.equal(await App.ExportReport("default_template.md", metadata), true);
  assert.deepEqual(sent, [
    {
      method: "POST",
      path: "/report",
      search: "",
      type: "application/json",
      body: {
        template: "default_template.md",
        title: "Acme Report",
        client: "Acme",
        type: "Web",
        scope: "*.acme.test",
        assessor: "r",
        start: "2026-10-18",
        end: "2026-11-01",
        is_draft: false,
        truncate_length: 1000,
        include_test_cases: false,
        created_at: "2026-11-01T12:00:00+05:45",
        custom_properties: { include_test_cases: false, engagement: "Q4" },
      },
    },
  ]);
  assert.deepEqual(saved, [{ filename: "Acme Report.md", bytes: rendered }]);
});

test("created_at keeps a zone west of UTC, and a report without the include key takes test cases", async () => {
  process.env.TZ = "America/St_Johns";
  answers["POST /report"] = () => new Response(rendered);
  await App.ExportReport("default_template.md", { ...metadata, custom_properties: {} });
  assert.equal(sent[0].body.created_at, "2026-11-01T02:45:00-03:30");
  assert.equal(sent[0].body.include_test_cases, true);
});

test("the saved name is the title with the template's extension once, or the template's name without a title", async () => {
  answers["POST /report"] = () => new Response(rendered);
  await App.ExportReport("custom.html", { ...metadata, title: "Acme.html" });
  await App.ExportReport("custom.html", { ...metadata, title: "" });
  assert.deepEqual(
    saved.map((s) => s.filename),
    ["Acme.html", "custom.html"],
  );
});

test("a cancelled save resolves false", async () => {
  saveAs = "";
  answers["POST /report"] = () => new Response(rendered);
  assert.equal(await App.ExportReport("default_template.md", metadata), false);
});

test("a template that fails to render rejects with Marasi's message and saves nothing", async () => {
  answers["POST /report"] = () =>
    json({ error: "invalid_report_request", message: 'map has no entry for key "engagement"' }, 400);
  await assert.rejects(App.ExportReport("props.md", metadata), /engagement/);
  assert.deepEqual(saved, []);
});

test("UploadReportTemplate sends the file's bytes under its name and answers the new list", async () => {
  answers["POST /report/template"] = templates;
  const bytes = new TextEncoder().encode("title={{.Metadata.Title}}");
  assert.deepEqual(await App.UploadReportTemplate("custom.md", bytes), ["custom.md", "default_template.md"]);
  assert.equal(sent[0].search, "?name=custom.md");
  assert.equal(sent[0].type, "application/octet-stream");
  assert.deepEqual(sent[0].body, bytes);
});

test("a template whose name is taken is refused with Marasi's code", async () => {
  answers["POST /report/template"] = () => json({ error: "report_template_already_exists" }, 409);
  await assert.rejects(App.UploadReportTemplate("custom.md", new Uint8Array()), /report_template_already_exists/);
});

test("DeleteReportTemplate and RestoreDefaultReportTemplate answer the list after the change", async () => {
  answers["DELETE /report/template/my%20notes.md"] = { items: [{ name: "default_template.md", size: 1 }] };
  answers["POST /report/template/restore"] = templates;
  assert.deepEqual(await App.DeleteReportTemplate("my notes.md"), ["default_template.md"]);
  assert.deepEqual(await App.RestoreDefaultReportTemplate(), ["custom.md", "default_template.md"]);
  assert.deepEqual(
    sent.map((s) => `${s.method} ${s.path}`),
    ["DELETE /report/template/my%20notes.md", "POST /report/template/restore"],
  );
});
