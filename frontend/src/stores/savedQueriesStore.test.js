import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import {
  activeSavedQuery,
  BUILTIN_QUERIES,
  canSaveQuery,
  hiddenBuiltinCount,
  createSavedQueriesStore,
  savedQueryGroups,
  visibleSavedQueries,
} from "./createSavedQueriesStore.js";
import { createSavedQueriesApi } from "./savedQueriesApi.js";
import { createExclusion } from "./contentTypeExclusion.js";
import { fakeServiceClient } from "./fakeServiceClient.js";

// An in-memory config file: the app-wide saved queries and hidden built-in
// ids, as the Go side keeps them (sorted by order on save), plus match
// counts by query text, plus the open project's client settings
// (`api.settings`, key -> value). Calls are recorded in `api.calls`.
function fakeApi({ queries = [], hidden = [], counts = {}, settings = {} } = {}) {
  const calls = [];
  const api = {
    calls,
    settings,
    listClientSettings: async (prefix) =>
      Object.keys(api.settings)
        .filter((key) => key.startsWith(prefix))
        .sort()
        .map((key) => ({ client: "marasi-app", key, value: structuredClone(api.settings[key]) })),
    setClientSetting: async (key, value) => {
      calls.push(["setClientSetting", key, value]);
      api.settings = { ...api.settings, [key]: structuredClone(value) };
      return { client: "marasi-app", key, value };
    },
    deleteClientSetting: async (key) => {
      calls.push(["deleteClientSetting", key]);
      const { [key]: _, ...rest } = api.settings;
      api.settings = rest;
    },
    getAppSavedQueries: async () => ({
      queries: queries.map((q) => ({ ...q })),
      hidden_builtins: [...hidden],
    }),
    saveAppSavedQueries: async (list) => {
      calls.push(["saveAppSavedQueries", list]);
      queries = [...list].sort((a, b) => a.order - b.order);
      return queries.map((q) => ({ ...q }));
    },
    setHiddenBuiltins: async (ids) => {
      calls.push(["setHiddenBuiltins", ids]);
      hidden = [...ids];
      return [...hidden];
    },
    countMatches: async (query) => {
      calls.push(["countMatches", query]);
      const count = counts[query];
      if (typeof count === "function") return count();
      return count ?? { Count: 0, Capped: false, QueryError: null };
    },
  };
  return api;
}

let nextId = 0;
const newId = () => `id-${++nextId}`;

const noise = { id: "n", name: "Third-party noise", query: 'host != "*.acme.test"', order: 0 };
const marked = { id: "m", name: "Highlighted", query: "highlight:*", order: 1 };

async function loadedStore(api) {
  const store = createSavedQueriesStore(api, { newId });
  await store.load();
  return store;
}

const names = (items) => items.map((q) => q.name);

// A project saved query as a client setting, keyed ledger.saved_query.<uuid>.
const projectSetting = (id, name, query, order) => ({
  [`ledger.saved_query.${id}`]: { name, query, order },
});
const group = (store, key) => savedQueryGroups(get(store)).find((g) => g.key === key);

test("the built-ins are the spec's six", () => {
  assert.deepEqual(
    BUILTIN_QUERIES.map((q) => [q.name, q.query]),
    [
      ["Server errors", "status_code >= 500"],
      ["Client errors", "status_code >= 400 AND status_code < 500"],
      ["Redirects", "status_code >= 300 AND status_code < 400"],
      ["Writes", 'method = "POST" OR method = "PUT" OR method = "PATCH" OR method = "DELETE"'],
      ["Cookies set", 'response_head:"set-cookie"'],
      ["JWTs anywhere", '"eyJhbGci"'],
    ],
  );
});

test("load groups the app-wide queries under All projects, then the built-ins", async () => {
  const store = await loadedStore(fakeApi({ queries: [noise, marked] }));
  const groups = savedQueryGroups(get(store));

  assert.deepEqual(
    groups.map((g) => g.label),
    ["All projects", "Built-in"],
  );
  assert.deepEqual(names(groups[0].items), ["Third-party noise", "Highlighted"]);
  assert.equal(groups[1].items.length, 6);
  assert.deepEqual(
    names(visibleSavedQueries(get(store))).slice(0, 3),
    ["Third-party noise", "Highlighted", "Server errors"],
  );
});

test("a hidden built-in leaves the menu until hidden built-ins are shown", async () => {
  const api = fakeApi({ hidden: ["writes"] });
  const store = await loadedStore(api);

  const builtins = savedQueryGroups(get(store)).find((g) => g.key === "builtin");
  assert.ok(!names(builtins.items).includes("Writes"));
  assert.ok(!names(visibleSavedQueries(get(store))).includes("Writes"));
  assert.equal(hiddenBuiltinCount(get(store)), 1);

  const shown = savedQueryGroups(get(store), { showHidden: true }).find((g) => g.key === "builtin");
  const writes = shown.items.find((q) => q.name === "Writes");
  assert.equal(writes.hidden, true);
});

test("hiding and showing a built-in writes the hidden ids", async () => {
  const api = fakeApi();
  const store = await loadedStore(api);

  await store.setBuiltinHidden("redirects", true);
  await store.setBuiltinHidden("writes", true);
  assert.deepEqual(get(store).hiddenBuiltins, ["redirects", "writes"]);

  await store.setBuiltinHidden("redirects", false);
  assert.deepEqual(api.calls.at(-1), ["setHiddenBuiltins", ["writes"]]);
  assert.deepEqual(get(store).hiddenBuiltins, ["writes"]);
});

test("saving a query appends it to All projects with a new id", async () => {
  const api = fakeApi({ queries: [noise] });
  const store = await loadedStore(api);

  const saved = await store.save("  Admin denied ", "status_code = 403");

  assert.equal(saved.name, "Admin denied");
  assert.equal(saved.source, "app");
  const [, written] = api.calls.at(-1);
  assert.deepEqual(
    written.map((q) => [q.name, q.query, q.order]),
    [
      ["Third-party noise", 'host != "*.acme.test"', 0],
      ["Admin denied", "status_code = 403", 1],
    ],
  );
  assert.ok(written[1].id);
  assert.deepEqual(names(savedQueryGroups(get(store))[0].items), ["Third-party noise", "Admin denied"]);
});

test("a query saved without a name is named after its text", async () => {
  const store = await loadedStore(fakeApi());
  const saved = await store.save("  ", 'host = "admin.acme.test" AND status_code = 403 AND method = "GET"');
  assert.equal(saved.name, 'host = "admin.acme.test" AND sta…');
});

test("renaming keeps the query and its place; a blank name keeps the old one", async () => {
  const api = fakeApi({ queries: [noise, marked] });
  const store = await loadedStore(api);
  const entry = savedQueryGroups(get(store))[0].items[0];

  await store.rename(entry, " Noise ");
  assert.deepEqual(names(savedQueryGroups(get(store))[0].items), ["Noise", "Highlighted"]);

  const calls = api.calls.length;
  await store.rename(savedQueryGroups(get(store))[0].items[0], "   ");
  assert.equal(api.calls.length, calls, "nothing to write");
  assert.equal(savedQueryGroups(get(store))[0].items[0].name, "Noise");
});

test("deleting removes only that query", async () => {
  const api = fakeApi({ queries: [noise, marked] });
  const store = await loadedStore(api);

  await store.remove(savedQueryGroups(get(store))[0].items[0]);

  assert.deepEqual(names(savedQueryGroups(get(store))[0].items), ["Highlighted"]);
  assert.deepEqual(names((await api.getAppSavedQueries()).queries), ["Highlighted"]);
});

test("a failed write leaves the menu as it was and rejects", async () => {
  const api = fakeApi({ queries: [noise] });
  api.saveAppSavedQueries = async () => {
    throw new Error("disk full");
  };
  const store = await loadedStore(api);

  await assert.rejects(store.save("New", "note:*"), /disk full/);
  assert.deepEqual(names(savedQueryGroups(get(store))[0].items), ["Third-party noise"]);
});

test("the active saved query is the one whose query is the box's text, hidden built-ins included", async () => {
  const store = await loadedStore(fakeApi({ queries: [noise], hidden: ["server-errors"] }));
  const state = get(store);

  assert.equal(activeSavedQuery(state, ' host != "*.acme.test" ')?.name, "Third-party noise");
  assert.equal(activeSavedQuery(state, "status_code >= 400 AND status_code < 500")?.name, "Client errors");
  assert.equal(activeSavedQuery(state, "status_code >= 500")?.name, "Server errors", "a hidden built-in is still saved");
  assert.equal(activeSavedQuery(state, ""), null);
  assert.equal(canSaveQuery(state, "status_code >= 500", true), false);
});

// A write that waits until `release()`, or fails with `fail(error)`.
function heldWrite() {
  let release;
  let fail;
  const promise = new Promise((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  return { promise, release: (value) => release(value), fail: (error) => fail(error) };
}

test("saving, renaming and deleting show in the menu before the write lands", async () => {
  const api = fakeApi({ queries: [noise], settings: projectSetting("p1", "Login", 'path = "/login"', 0) });
  const store = await loadedStore(api);
  const save = api.saveAppSavedQueries;
  let held = heldWrite();
  api.saveAppSavedQueries = async (list) => {
    await held.promise;
    return save(list);
  };

  const saving = store.save("Notes", "note:*", "app");
  assert.deepEqual(names(group(store, "app").items), ["Third-party noise", "Notes"]);
  held.release();
  await saving;
  assert.deepEqual(names(group(store, "app").items), ["Third-party noise", "Notes"]);

  held = heldWrite();
  const renaming = store.rename(group(store, "app").items[0], "Noise");
  assert.deepEqual(names(group(store, "app").items), ["Noise", "Notes"]);
  held.release();
  await renaming;

  const setSetting = api.setClientSetting;
  const projectHeld = heldWrite();
  api.setClientSetting = async (key, value) => {
    await projectHeld.promise;
    return setSetting(key, value);
  };
  const renamingProject = store.rename(group(store, "project").items[0], "Sign in");
  assert.deepEqual(names(group(store, "project").items), ["Sign in"]);
  projectHeld.release();
  await renamingProject;
  assert.equal(api.settings["ledger.saved_query.p1"].name, "Sign in");
});

test("a failed write puts the menu back after showing the change at once", async () => {
  const api = fakeApi({ queries: [noise], settings: projectSetting("p1", "Login", 'path = "/login"', 0) });
  const store = await loadedStore(api);
  const held = heldWrite();
  api.deleteClientSetting = () => held.promise;

  const removing = store.remove(group(store, "project").items[0]);
  assert.equal(group(store, "project"), undefined, "gone at once");
  held.fail(new Error("locked"));
  await assert.rejects(removing, /locked/);
  assert.deepEqual(names(group(store, "project").items), ["Login"]);
});

test("hiding a built-in shows at once and comes back when the write fails", async () => {
  const api = fakeApi();
  const store = await loadedStore(api);
  const held = heldWrite();
  api.setHiddenBuiltins = () => held.promise;

  const hiding = store.setBuiltinHidden("server-errors", true);
  assert.equal(hiddenBuiltinCount(get(store)), 1);
  held.fail(new Error("disk full"));
  await assert.rejects(hiding, /disk full/);
  assert.equal(hiddenBuiltinCount(get(store)), 0);
});

test("a move shows one copy at once, in its new place", async () => {
  const api = fakeApi({ queries: [noise, marked] });
  const store = await loadedStore(api);
  const held = heldWrite();
  const setSetting = api.setClientSetting;
  api.setClientSetting = async (key, value) => {
    await held.promise;
    return setSetting(key, value);
  };

  const moving = store.move(group(store, "app").items[0], "project");
  assert.deepEqual(names(group(store, "project").items), ["Third-party noise"]);
  assert.deepEqual(names(group(store, "app").items), ["Highlighted"]);
  held.release();
  await moving;
  assert.deepEqual(names(group(store, "project").items), ["Third-party noise"]);
  assert.deepEqual(names(group(store, "app").items), ["Highlighted"]);
});

test("only a valid query that isn't saved yet can be saved", async () => {
  const store = await loadedStore(fakeApi({ queries: [noise] }));
  const state = get(store);

  assert.equal(canSaveQuery(state, "note:*", true), true);
  assert.equal(canSaveQuery(state, "note:*", false), false, "invalid or not run yet");
  assert.equal(canSaveQuery(state, "   ", true), false);
  assert.equal(canSaveQuery(state, 'host != "*.acme.test"', true), false, "already saved");
  assert.equal(canSaveQuery(state, "status_code >= 500", true), false, "a built-in");
});

test("loadCounts fills in each query's count one at a time, keyed by query", async () => {
  const counts = {
    [noise.query]: { Count: 12, Capped: false, QueryError: null },
    "status_code >= 500": { Count: 100000, Capped: true, QueryError: null },
    '"eyJhbGci"': { Count: 0, Capped: false, QueryError: { Message: "term too short", Position: 1 } },
  };
  const api = fakeApi({ queries: [noise], counts });
  const store = await loadedStore(api);

  const loading = store.loadCounts();
  assert.deepEqual(get(store).counts, {}, "nothing before the first count returns");
  await loading;

  const state = get(store);
  assert.deepEqual(state.counts[noise.query], { count: 12, capped: false });
  assert.deepEqual(state.counts["status_code >= 500"], { count: 100000, capped: true });
  assert.deepEqual(state.counts['"eyJhbGci"'], { error: "term too short" });
  assert.equal(
    api.calls.filter(([name]) => name === "countMatches").length,
    7,
    "the app-wide query and the six built-ins",
  );
});

test("a newer loadCounts stops the older one", async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const api = fakeApi({
    queries: [noise],
    counts: { [noise.query]: () => gate.then(() => ({ Count: 1, Capped: false, QueryError: null })) },
  });
  const store = await loadedStore(api);

  const first = store.loadCounts();
  await Promise.resolve();
  const callsAfterFirst = api.calls.filter(([name]) => name === "countMatches").length;
  const second = store.loadCounts();
  release();
  await Promise.all([first, second]);

  // The first run counted only its first query before the second took over.
  assert.equal(callsAfterFirst, 1);
  assert.equal(api.calls.filter(([name]) => name === "countMatches").length, 1 + 7);
});

test("a failed count shows no count and the others still load", async () => {
  const api = fakeApi({
    queries: [noise],
    counts: {
      [noise.query]: () => Promise.reject(new Error("no project")),
      "status_code >= 500": { Count: 3, Capped: false, QueryError: null },
    },
  });
  const store = await loadedStore(api);
  await store.loadCounts();

  assert.equal(get(store).counts[noise.query], undefined);
  assert.deepEqual(get(store).counts["status_code >= 500"], { count: 3, capped: false });
});

test("load reads the config once; a failed read leaves the built-ins", async () => {
  const api = fakeApi({ queries: [noise] });
  let reads = 0;
  const read = api.getAppSavedQueries;
  api.getAppSavedQueries = () => (reads++, read());
  const store = createSavedQueriesStore(api, { newId });
  await Promise.all([store.load(), store.load()]);
  assert.equal(reads, 1);

  const broken = fakeApi();
  broken.getAppSavedQueries = async () => {
    throw new Error("unreadable");
  };
  const fallback = createSavedQueriesStore(broken, { newId });
  await fallback.load();
  assert.deepEqual(
    savedQueryGroups(get(fallback)).map((g) => g.key),
    ["builtin"],
    "empty groups are left out",
  );
});

test("hidden ids that no built-in has don't count as hidden built-ins", async () => {
  const store = await loadedStore(fakeApi({ hidden: ["writes", "retired-built-in"] }));
  assert.equal(hiddenBuiltinCount(get(store)), 1);
});

test("load groups the project's own queries under This project, first", async () => {
  const api = fakeApi({
    queries: [noise],
    settings: {
      ...projectSetting("p2", "Admin denied", "status_code = 403", 1),
      ...projectSetting("p1", "Login", 'path = "/login"', 0),
      "ledger.exclusion": ["image/*"],
    },
  });
  const store = await loadedStore(api);

  const groups = savedQueryGroups(get(store));
  assert.deepEqual(
    groups.map((g) => g.label),
    ["This project", "All projects", "Built-in"],
  );
  assert.deepEqual(
    groups[0].items.map((q) => [q.id, q.name, q.query, q.source]),
    [
      ["p1", "Login", 'path = "/login"', "project"],
      ["p2", "Admin denied", "status_code = 403", "project"],
    ],
  );
});

test("saving to the project writes one client setting after its other queries", async () => {
  const api = fakeApi({
    queries: [noise],
    settings: projectSetting("p1", "Login", 'path = "/login"', 0),
  });
  const store = await loadedStore(api);

  const saved = await store.save(" Admin denied ", "status_code = 403", "project");

  assert.equal(saved.source, "project");
  assert.deepEqual(api.calls, [
    ["setClientSetting", `ledger.saved_query.${saved.id}`, { name: "Admin denied", query: "status_code = 403", order: 1 }],
  ]);
  assert.deepEqual(names(group(store, "project").items), ["Login", "Admin denied"]);
  assert.deepEqual(names(group(store, "app").items), ["Third-party noise"], "the app list is untouched");
});

test("renaming and deleting a project query rewrite only its own key", async () => {
  const api = fakeApi({
    settings: {
      ...projectSetting("p1", "Login", 'path = "/login"', 0),
      ...projectSetting("p2", "Admin denied", "status_code = 403", 1),
    },
  });
  const store = await loadedStore(api);

  await store.rename(group(store, "project").items[1], "Forbidden");
  assert.deepEqual(api.calls.at(-1), [
    "setClientSetting",
    "ledger.saved_query.p2",
    { name: "Forbidden", query: "status_code = 403", order: 1 },
  ]);
  assert.deepEqual(names(group(store, "project").items), ["Login", "Forbidden"]);

  await store.remove(group(store, "project").items[0]);
  assert.deepEqual(api.calls.at(-1), ["deleteClientSetting", "ledger.saved_query.p1"]);
  assert.deepEqual(names(group(store, "project").items), ["Forbidden"]);
  assert.deepEqual(Object.keys(api.settings), ["ledger.saved_query.p2"]);
});

test("moving a query between this project and all projects leaves exactly one copy", async () => {
  const api = fakeApi({
    queries: [noise, marked],
    settings: projectSetting("p1", "Login", 'path = "/login"', 0),
  });
  const store = await loadedStore(api);

  await store.move(group(store, "app").items[0], "project");
  assert.deepEqual(names(group(store, "project").items), ["Login", "Third-party noise"]);
  assert.deepEqual(names(group(store, "app").items), ["Highlighted"]);
  assert.deepEqual(api.settings["ledger.saved_query.n"], { name: "Third-party noise", query: noise.query, order: 1 });
  assert.deepEqual(names((await api.getAppSavedQueries()).queries), ["Highlighted"]);

  await store.move(group(store, "project").items[0], "app");
  assert.deepEqual(names(group(store, "project").items), ["Third-party noise"]);
  assert.deepEqual(names(group(store, "app").items), ["Highlighted", "Login"]);
  assert.deepEqual(Object.keys(api.settings), ["ledger.saved_query.n"]);
  assert.deepEqual(
    (await api.getAppSavedQueries()).queries.map((q) => [q.id, q.name, q.order]),
    [
      ["m", "Highlighted", 1],
      ["p1", "Login", 2],
    ],
  );
});

test("opening another project shows only that project's queries", async () => {
  const api = fakeApi({ queries: [noise], settings: projectSetting("p1", "Login", 'path = "/login"', 0) });
  const store = await loadedStore(api);

  api.settings = projectSetting("q1", "Uploads", 'path:"/upload"', 0);
  await store.loadProject();
  assert.deepEqual(names(group(store, "project").items), ["Uploads"]);

  api.settings = {};
  await store.load();
  assert.equal(group(store, "project"), undefined);
  assert.deepEqual(names(group(store, "app").items), ["Third-party noise"]);

  api.listClientSettings = async () => {
    throw new Error("no project is open");
  };
  api.settings = projectSetting("q1", "Uploads", 'path:"/upload"', 0);
  await store.loadProject();
  assert.equal(group(store, "project"), undefined, "a failed read shows none");
});

test("a project read that a newer one overtakes is dropped", async () => {
  const api = fakeApi();
  const store = await loadedStore(api);
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const list = api.listClientSettings;
  api.listClientSettings = (prefix) => gate.then(() => [{ key: "ledger.saved_query.old", value: { name: "Old", query: "a", order: 0 } }]);
  const first = store.loadProject();
  api.listClientSettings = list;
  api.settings = projectSetting("new", "New", "b", 0);
  await store.loadProject();
  release();
  await first;
  assert.deepEqual(names(group(store, "project").items), ["New"]);
});

test("unusable project values are skipped", async () => {
  const api = fakeApi({
    settings: {
      "ledger.saved_query.ok": { name: "Ok", query: "a", order: 0 },
      "ledger.saved_query.noquery": { name: "No query", query: " ", order: 1 },
      "ledger.saved_query.junk": "not an object",
    },
  });
  const store = await loadedStore(api);
  assert.deepEqual(names(group(store, "project").items), ["Ok"]);
});

test("a move whose delete fails takes back the new copy and rejects", async () => {
  const api = fakeApi({ queries: [noise] });
  api.saveAppSavedQueries = async () => {
    throw new Error("disk full");
  };
  const store = await loadedStore(api);

  await assert.rejects(store.move(group(store, "app").items[0], "project"), /disk full/);
  assert.equal(group(store, "project"), undefined, "no project copy is left");
  assert.deepEqual(api.settings, {});
  assert.deepEqual(names(group(store, "app").items), ["Third-party noise"]);
});

// Over the service: app-wide queries stay in the app config (Go), the
// project's are client settings, and counts leave out the exclusion.
function serviceSetup(settings = {}) {
  const client = fakeServiceClient({
    "GET /client-settings/marasi-app": (query) => ({
      items: Object.keys(settings)
        .filter((key) => key.startsWith(query.prefix ?? ""))
        .sort()
        .map((key) => ({ client: "marasi-app", key, value: settings[key], updated_at: "2026-11-06T18:07:12Z" })),
    }),
    "GET /client-settings/marasi-app/ledger.exclusion": { status: 404, body: { error: "not_found" } },
    "GET /traffic/count": (query) => (query.q === "(" ? { status: 400, body: { error: "invalid_query", message: "bad", position: 1 } } : { count: 7, capped: false, index: { complete: true } }),
  });
  const appConfig = {
    getAppSavedQueries: async () => ({ queries: [], hidden_builtins: [] }),
    saveAppSavedQueries: async (list) => list,
    setHiddenBuiltins: async (ids) => ids,
    getDefaultExclusion: async () => ["image/*"],
    setDefaultExclusion: async () => {},
  };
  const exclusion = createExclusion(client, appConfig);
  return { client, store: createSavedQueriesStore(createSavedQueriesApi(client, { appConfig, exclusion })) };
}

test("over the service, the project's saved queries are client settings and resync rereads them", async () => {
  const settings = { "ledger.saved_query.q1": { name: "Logins", query: 'path = "/login"', order: 0 } };
  const { store, client } = serviceSetup(settings);
  await store.load();
  assert.deepEqual(
    get(store).queries.project.map((q) => q.name),
    ["Logins"],
  );
  assert.deepEqual(client.calls[0].query, { prefix: "ledger.saved_query." });

  // Another client saved one in the project.
  settings["ledger.saved_query.q2"] = { name: "Admin", query: 'path = "/admin"', order: 1 };
  await store.loadProject();
  assert.deepEqual(
    get(store).queries.project.map((q) => q.name),
    ["Logins", "Admin"],
  );
});

test("over the service, saving a project query writes its client setting", async () => {
  const { store, client } = serviceSetup();
  client.put = async (path, body) => {
    client.calls.push({ method: "PUT", path, body });
    return { client: "marasi-app", key: path.split("/").pop(), value: body.value };
  };
  await store.load();
  const entry = await store.save("Errors", "status_code >= 500", "project");
  const put = client.calls.find((call) => call.method === "PUT");
  assert.equal(put.path, `/client-settings/marasi-app/ledger.saved_query.${entry.id}`);
  assert.deepEqual(put.body, { value: { name: "Errors", query: "status_code >= 500", order: 0 } });
});

test("over the service, saved-query counts leave out the exclusion and report a bad query", async () => {
  const { store, client } = serviceSetup({
    "ledger.saved_query.q1": { name: "Bad", query: "(", order: 0 },
    "ledger.saved_query.q2": { name: "Good", query: 'host = "a"', order: 1 },
  });
  await store.load();
  await store.loadCounts();
  const counts = get(store).counts;
  assert.deepEqual(counts["("], { error: "bad" });
  assert.deepEqual(counts['host = "a"'], { count: 7, capped: false });
  const count = client.calls.find((call) => call.path === "/traffic/count" && call.query.q === 'host = "a"');
  assert.deepEqual(count.query.exclude, ["image/*"]);
});
