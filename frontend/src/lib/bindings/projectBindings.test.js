// The project bindings: opening a project on the connected instance by name
// or by a path on the instance machine, its project list, and the GUI-owned
// user name and file dialog.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as App from "./App.js";
import { useConnection } from "./marasi.js";

let sent;
let answers;
const realFetch = globalThis.fetch;

beforeEach(() => {
  sent = [];
  answers = {};
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const method = init.method ?? "GET";
    sent.push({ method, path, body: init.body ? JSON.parse(init.body) : undefined });
    const answer = answers[`${method} ${path}`] ?? { body: {} };
    return new Response(JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  useConnection("http://127.0.0.1:50037");
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete globalThis.window;
});

test("OpenProject opens a bare name in the instance's projects and resolves the path it opened", async () => {
  answers["POST /project/open"] = { body: { project: "/home/r/.config/Marasi/projects/acme.marasi" } };
  assert.equal(await App.OpenProject("acme"), "/home/r/.config/Marasi/projects/acme.marasi");
  assert.deepEqual(sent, [{ method: "POST", path: "/project/open", body: { name: "acme" } }]);
});

test("OpenProject opens a path on the instance machine as a path", async () => {
  answers["POST /project/open"] = { body: { project: "/srv/work/acme.marasi" } };
  await App.OpenProject("/srv/work/acme.marasi");
  await App.OpenProject("C:\\work\\acme.marasi");
  assert.deepEqual(
    sent.map(({ body }) => body),
    [{ path: "/srv/work/acme.marasi" }, { path: "C:\\work\\acme.marasi" }],
  );
});

test("OpenProject rejects a locked project with Marasi's code", async () => {
  answers["POST /project/open"] = { status: 409, body: { error: "project_already_open" } };
  await assert.rejects(App.OpenProject("acme"), (error) => error.code === "project_already_open");
});

test("GetRecentProjects lists the instance's projects", async () => {
  const items = [{ name: "acme", project: "/p/acme.marasi", modified_at: "2026-10-31T10:00:00Z" }];
  answers["GET /project/list"] = { body: { items } };
  assert.deepEqual(await App.GetRecentProjects(), items);
});

test("ScratchpadPath is the instance's scratchpad from its project list", async () => {
  answers["GET /project/list"] = {
    body: { items: [{ name: "acme", project: "/p/acme.marasi" }, { name: "scratchpad", project: "/p/scratchpad.marasi" }] },
  };
  assert.equal(await App.ScratchpadPath(), "/p/scratchpad.marasi");
});

test("GetUserName and OpenFileDialog are this machine's, through the main process", async () => {
  let title;
  globalThis.window = {
    marasiApp: {
      userName: async () => "researcher",
      pickProject: async (asked) => {
        title = asked;
        return "/Users/r/acme.marasi";
      },
    },
  };
  assert.equal(await App.GetUserName(), "researcher");
  assert.equal(await App.OpenFileDialog(), "/Users/r/acme.marasi");
  assert.equal(title, "Open project");
});
