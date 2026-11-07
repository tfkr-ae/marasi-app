// A user action of several service calls, overtaken by a connection switch
// between two of its steps: each store runs over its real api and the real
// service client (switchingService.js), which moves from A to B as the
// first step's answer comes back. The next step never reaches B, and the
// action stops with a superseded error the UI shows nothing for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { switchingService } from "./switchingService.js";
import { isSuperseded } from "../lib/service/errors.js";
import { createLedgerApi } from "./ledgerApi.js";
import { createLedgerStore } from "./createLedgerStore.js";
import { createExclusion } from "./contentTypeExclusion.js";
import { createArmoryApi } from "./armoryApi.js";
import { createArmoryStore } from "./createArmoryStore.js";
import { get } from "svelte/store";
import { createLogbookApi } from "./logbookApi.js";
import { createLogbookStore } from "./createLogbookStore.js";
import { writable } from "svelte/store";
import { createJobsApi } from "./jobsApi.js";
import { createJobsStore } from "./createJobsStore.js";
import { createCheckpointApi } from "./checkpointApi.js";
import { createCheckpointStore } from "./createCheckpointStore.js";
import { createWebSocketApi } from "./webSocketApi.js";
import { createWebSocketStore } from "./createWebSocketStore.js";
import { createExtensionsApi } from "./extensionsApi.js";
import { createExtensionsStore } from "./createExtensionsStore.js";
import { createHighlightsApi } from "./highlightsApi.js";
import { createHighlightsStore } from "./createHighlightsStore.js";
import { createSavedQueriesApi } from "./savedQueriesApi.js";
import { createSavedQueriesStore, PROJECT_QUERY_PREFIX } from "./createSavedQueriesStore.js";

const superseded = (err) => isSuperseded(err);
const b64 = (text) => Buffer.from(text).toString("base64");
const pair = (id) => ({ id, request: { method: "GET", host: "x.test", path: `/${id}`, raw: b64(`GET /${id} HTTP/1.1\r\n\r\n`) } });

const appConfig = { getDefaultExclusion: async () => [], setDefaultExclusion: async () => {} };

function ledgerOver(service) {
  const armory = createArmoryStore(createArmoryApi(service.client));
  const api = createLedgerApi(service.client, { exclusion: createExclusion(service.client, appConfig) });
  // As ledgerStore.js wires it: Armory templates go through their store.
  return createLedgerStore({ ...api, sendToArmory: (id) => armory.createTemplateFromRequest(id) });
}

const ledgerRoutes = {
  "POST /launchpad": { id: "lp1" },
  "POST /traffic/bulk/link": { count: 1 },
  "GET /traffic/1": pair("1"),
  "GET /traffic/2": pair("2"),
  "POST /armory/template": { id: "t1", name: "GET x.test/1" },
};

test("Ledger one launchpad each: a switch after the first create links nothing on B", async () => {
  const service = switchingService(ledgerRoutes);
  const ledger = ledgerOver(service);
  service.switchWhen("POST /launchpad");

  await assert.rejects(ledger.sendToLaunchpadsEach(["1", "2"]), superseded);

  assert.deepEqual(service.onA(), ["POST /launchpad"]);
  assert.deepEqual(service.onB(), []);
});

test("Ledger new launchpad: a switch after the create links nothing on B", async () => {
  const service = switchingService(ledgerRoutes);
  const ledger = ledgerOver(service);
  service.switchWhen("POST /launchpad");

  await assert.rejects(ledger.sendToNewLaunchpad({ ids: ["1", "2"] }), superseded);

  assert.deepEqual(service.onA(), ["POST /launchpad"]);
  assert.deepEqual(service.onB(), []);
});

test("Ledger send to Armory: a switch after the first template sends no other pair to B", async () => {
  const service = switchingService(ledgerRoutes);
  const ledger = ledgerOver(service);
  service.switchWhen("POST /armory/template");

  await assert.rejects(ledger.sendToArmory(["1", "2"]), superseded);

  assert.deepEqual(service.onA(), ["GET /traffic/1", "POST /armory/template"]);
  assert.deepEqual(service.onB(), []);
});

test("Armory template from a request: a switch after reading the pair creates nothing on B", async () => {
  const service = switchingService(ledgerRoutes);
  const armory = createArmoryStore(createArmoryApi(service.client));
  service.switchWhen("GET /traffic/1");

  await assert.rejects(armory.createTemplateFromRequest("1"), superseded);

  assert.deepEqual(service.onB(), []);
});

const armoryRoutes = {
  "POST /armory/template/t1": { id: "t1", name: "T" },
  "POST /armory/run": { id: "r1", template_id: "t1", status: "draft" },
  "POST /armory/run/r1/start": { id: "r1", template_id: "t1", status: "in_progress" },
  "GET /armory/run/r1": { id: "r1", template_id: "t1", status: "in_progress" },
};
const runOf = { templateId: "t1", attackType: "sniper", wordlists: [], maxConcurrent: 1 };

test("Armory launch: a switch after the run is created starts nothing on B", async () => {
  const service = switchingService(armoryRoutes);
  const armory = createArmoryStore(createArmoryApi(service.client));
  service.switchWhen("POST /armory/run");

  await assert.rejects(armory.launchRun(runOf, { start: true }), superseded);

  assert.deepEqual(service.onA(), ["POST /armory/run"]);
  assert.deepEqual(service.onB(), []);
});

test("Armory launch: a switch after the template is saved creates no run on B", async () => {
  const service = switchingService(armoryRoutes);
  const armory = createArmoryStore(createArmoryApi(service.client));
  service.switchWhen("POST /armory/template/t1");
  const save = async () => {
    await armory.updateTemplate("t1", { name: "T", rawTemplate: "GET / HTTP/1.1" });
    return true;
  };

  await assert.rejects(armory.launchRun(runOf, { save, start: true }), superseded);

  assert.deepEqual(service.onB(), []);
});

test("Armory launch on one connection saves, creates and starts the run", async () => {
  const service = switchingService(armoryRoutes);
  const armory = createArmoryStore(createArmoryApi(service.client));
  const created = [];

  const run = await armory.launchRun(runOf, { start: true, created: (r) => created.push(r.ID) });

  assert.equal(run.ID, "r1");
  assert.deepEqual(created, ["r1"]);
  assert.deepEqual(service.onA(), ["POST /armory/run", "POST /armory/run/r1/start", "GET /armory/run/r1"]);
});

const finding = (id, extra = {}) => ({ id, title: "Draft Finding", severity: "High", created_at: "2026-11-07T10:00:00Z", ...extra });
const logbookRoutes = {
  "POST /finding": finding("f9"),
  "POST /finding/f9/traffic": (body) => ({ finding_id: "f9", id: body.id }),
  "POST /finding/f9": (body) => finding("f9", body),
};

function newFinding(service) {
  const logbook = createLogbookStore(createLogbookApi(service.client, { saveFile: async () => true }));
  logbook.startNew("finding", { requestIds: ["r1", "r2"] });
  logbook.updateDraft({ Title: "Stored XSS", WriteUp: "Steps" });
  return logbook;
}

test("Logbook save: a switch after the record is created links no request on B", async () => {
  const service = switchingService(logbookRoutes);
  const logbook = newFinding(service);
  service.switchWhen("POST /finding");

  const result = await logbook.save();

  assert.deepEqual(result, { ok: false, reason: "superseded" });
  assert.deepEqual(service.onA(), ["POST /finding"]);
  assert.deepEqual(service.onB(), []);
  assert.equal(get(logbook).session.error, null);
});

test("Logbook save: a switch after a request is linked writes no field on B", async () => {
  const service = switchingService(logbookRoutes);
  const logbook = newFinding(service);
  service.switchWhen("POST /finding/f9/traffic");

  const result = await logbook.save();

  assert.equal(result.reason, "superseded");
  assert.deepEqual(service.onA(), ["POST /finding", "POST /finding/f9/traffic"]);
  assert.deepEqual(service.onB(), []);
});

test("Jobs rebuild: a switch after the first job's rebuild rebuilds nothing on B", async () => {
  const service = switchingService({ "GET /jobs": { items: [] } });
  const jobs = createJobsStore(createJobsApi(service.client), { timer: { setTimeout: () => 0, clearTimeout: () => {} } });
  service.switchWhen("POST /jobs/traffic_index/rebuild");

  await assert.rejects(jobs.rebuild("index"), superseded);

  assert.deepEqual(service.onA(), ["POST /jobs/traffic_index/rebuild"]);
  assert.deepEqual(service.onB(), []);
});

const flags = { items: [], intercept: false, websocket_intercept: false };

test("Checkpoint Intercept all: a switch after reading the flag turns nothing on B", async () => {
  const service = switchingService({ "GET /checkpoint": flags, "POST /checkpoint/intercept": flags });
  const checkpoint = createCheckpointStore(createCheckpointApi(service.client), { interceptFlag: writable(false) });
  service.switchWhen("GET /checkpoint");

  await assert.rejects(checkpoint.toggleIntercept(), superseded);

  assert.deepEqual(service.onB(), []);
});

test("WebSocket intercept: a switch after reading the flag turns nothing on B", async () => {
  const service = switchingService({ "GET /checkpoint": flags, "POST /checkpoint/websocket-intercept": flags });
  const webSocket = createWebSocketStore(createWebSocketApi(service.client));
  service.switchWhen("GET /checkpoint");

  await webSocket.toggleIntercept();

  assert.deepEqual(service.onA(), ["GET /checkpoint"]);
  assert.deepEqual(service.onB(), []);
});

test("Extension call: a switch after finding the extension calls nothing on B", async () => {
  const service = switchingService({ "GET /extension": { items: [{ id: "e1", name: "probe", enabled: true }] } });
  const extensions = createExtensionsStore(createExtensionsApi(service.client));
  service.switchWhen("GET /extension");

  await assert.rejects(extensions.call("probe", "run"), superseded);

  assert.deepEqual(service.onB(), []);
});

test("Highlight rename for all projects: a switch while the app label saves drops no project label on B", async () => {
  const service = switchingService({
    "GET /client-settings/marasi-app": { items: [{ key: "ledger.highlight.3", value: "IDOR" }] },
  });
  const highlights = createHighlightsStore(
    createHighlightsApi(service.client, {
      getHighlights: async () => null,
      // The app config is Go's: the switch happens while it saves.
      saveHighlights: async (list) => (service.switchNow(), list),
      resetHighlights: async () => null,
    }),
  );
  await highlights.loadProject();

  await assert.rejects(highlights.rename(3, "Auth bypass", { allProjects: true }), superseded);

  assert.deepEqual(service.onB(), []);
});

test("Saved query move to the app: a switch while the app copy saves removes nothing on B", async () => {
  const service = switchingService({
    "GET /client-settings/marasi-app": {
      items: [{ key: `${PROJECT_QUERY_PREFIX}q1`, value: { name: "Admin", query: "path:/admin", order: 0 } }],
    },
  });
  const appQueries = [];
  const savedQueries = createSavedQueriesStore(
    createSavedQueriesApi(service.client, {
      appConfig: {
        getAppSavedQueries: async () => ({ queries: [] }),
        // The app config is Go's: the switch happens while it saves.
        saveAppSavedQueries: async (list) => (appQueries.splice(0, Infinity, ...list), service.switchNow(), list),
        setHiddenBuiltins: async () => {},
      },
      exclusion: { effective: async () => [] },
    }),
    { timers: { setTimeout: () => 0, clearTimeout: () => {} } },
  );
  await savedQueries.load();
  const [entry] = get(savedQueries).queries.project;

  await assert.rejects(savedQueries.move(entry, "app"), superseded);

  assert.deepEqual(service.onB(), []);
  // The app copy is taken back: the query stays the project's, on A.
  assert.deepEqual(appQueries, []);
});
