// Settings → Maintenance over the service: createJobsApi (over a fake
// service client) feeding createJobsStore.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createJobsApi } from "./jobsApi.js";
import { createJobsStore, groupBuilding, jobStatus } from "./createJobsStore.js";

function fakeClient(routes) {
  const calls = [];
  const call = (method) => async (path, body) => {
    calls.push([method, path]);
    const answer = routes[`${method} ${path}`];
    if (answer === undefined) throw new Error(`${method} ${path}: not_found: HTTP 404`);
    return typeof answer === "function" ? answer(body) : answer;
  };
  return { calls, get: call("GET"), post: call("POST") };
}

// A timer that never fires on its own.
const timer = { schedule: () => ({}), cancel: () => {} };

const jobs = {
  items: [
    { name: "traffic_index", complete: false, done: 1200, total: 5000 },
    { name: "annotation_index", complete: true, done: 0, total: 0 },
    { name: "sitemap", complete: true, done: 0, total: 0 },
    { name: "prettified_move", complete: true, done: 0, total: 0 },
    { name: "intercepted_count", complete: true, done: 0, total: 0 },
  ],
};

test("refresh shows the service's jobs and their progress", async () => {
  const client = fakeClient({ "GET /jobs": jobs });
  const store = createJobsStore(createJobsApi(client), { timer });
  await store.refresh();
  const state = get(store);
  assert.deepEqual(
    state.jobs.map((job) => job.Name),
    ["traffic_index", "annotation_index", "sitemap", "prettified_move", "intercepted_count"],
  );
  assert.equal(jobStatus(state.jobs[0]), `Building · ${(1200).toLocaleString()} of ${(5000).toLocaleString()}`);
  assert.equal(groupBuilding(state, "index"), true);
  assert.equal(groupBuilding(state, "sitemap"), false);
  assert.deepEqual(
    state.jobs.filter((job) => job.Rebuildable).map((job) => job.Name),
    ["traffic_index", "annotation_index", "sitemap"],
  );
});

test("rebuilding the index rebuilds both of its jobs on the service", async () => {
  const client = fakeClient({
    "GET /jobs": jobs,
    "POST /jobs/traffic_index/rebuild": { name: "traffic_index", complete: false, done: 0, total: 0 },
    "POST /jobs/annotation_index/rebuild": { name: "annotation_index", complete: false, done: 0, total: 0 },
  });
  const store = createJobsStore(createJobsApi(client), { timer });
  await store.rebuild("index");
  assert.deepEqual(client.calls, [
    ["POST", "/jobs/traffic_index/rebuild"],
    ["POST", "/jobs/annotation_index/rebuild"],
    ["GET", "/jobs"],
  ]);
});
