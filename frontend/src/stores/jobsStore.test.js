// Marasi's background jobs: reading ListJobs, following job.progress and
// job.complete, telling the Ledger and sitemap when the jobs they wait on
// finish, and rebuilding.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createJobsStore, jobLabel, jobStatus, groupBuilding } from "./createJobsStore.js";

const job = (Name, Complete, Done = 0, Total = 0, Rebuildable = Name !== "prettified_move") => ({
  Name,
  Complete,
  Done,
  Total,
  Rebuildable,
});
const allComplete = () => [
  job("traffic_index", true),
  job("annotation_index", true),
  job("sitemap", true),
  job("prettified_move", true),
];

// A fake api whose ListJobs answers come from `answers` in turn (the last
// repeats).
function setup(answers) {
  const calls = [];
  let n = 0;
  const api = {
    listJobs: async () => {
      calls.push("listJobs");
      const answer = answers[Math.min(n++, answers.length - 1)];
      if (answer instanceof Error) throw answer;
      return answer;
    },
    rebuildJob: async (name) => {
      calls.push(["rebuildJob", name]);
    },
  };
  const finished = [];
  const store = createJobsStore(api, { onFinished: (group) => finished.push(group) });
  return { store, calls, finished };
}

const reads = (calls) => calls.filter((c) => c === "listJobs").length;

test("refresh lists the jobs", async () => {
  const { store } = setup([allComplete()]);
  await store.refresh();
  assert.deepEqual(
    get(store).jobs.map((j) => j.Name),
    ["traffic_index", "annotation_index", "sitemap", "prettified_move"],
  );
});

test("job.progress shows a running job's progress", async () => {
  const { store } = setup([allComplete()]);
  await store.refresh();
  store.onJobProgress({ name: "sitemap", project: "/p.marasi", done: 1234, total: 5000 });
  assert.equal(groupBuilding(get(store), "sitemap"), true);
  assert.equal(jobStatus(get(store).jobs.find((j) => j.Name === "sitemap")), "Building · 1,234 of 5,000");
});

test("job.complete shows the job complete and tells the view that waits on it", async () => {
  const sitemapRunning = [...allComplete().slice(0, 2), job("sitemap", false), allComplete()[3]];
  const { store, finished } = setup([sitemapRunning]);
  store.watch("sitemap");
  await store.refresh();
  assert.deepEqual(finished, []);

  store.onJobComplete({ name: "sitemap", project: "/p.marasi" });

  assert.equal(groupBuilding(get(store), "sitemap"), false);
  assert.deepEqual(finished, ["sitemap"]);
});

test("a group of jobs finishes when its last job does", async () => {
  const rebuilt = [job("traffic_index", false), job("annotation_index", false)];
  const { store, finished } = setup([rebuilt]);
  store.watch("index");
  await store.refresh();

  store.onJobComplete({ name: "traffic_index" });
  assert.deepEqual(finished, []);
  store.onJobComplete({ name: "annotation_index" });
  assert.deepEqual(finished, ["index"]);
});

test("a watched group that is already complete finishes once the jobs are read", async () => {
  const { store, calls, finished } = setup([allComplete()]);
  store.watch("index");
  store.watch("index");
  await store.refresh();
  assert.deepEqual(finished, ["index"]);
  // Watching again while it waits reads the jobs only once.
  assert.equal(reads(calls), 2);
});

test("does not tell a view about a group it did not watch", async () => {
  const { store, finished } = setup([[job("traffic_index", false), ...allComplete().slice(1)]]);
  await store.refresh();
  store.onJobComplete({ name: "traffic_index" });
  assert.deepEqual(finished, []);
});

test("rebuilding the search index rebuilds both index jobs and follows their progress", async () => {
  const rebuilt = [job("traffic_index", false), job("annotation_index", false), ...allComplete().slice(2)];
  const { store, calls, finished } = setup([rebuilt]);

  await store.rebuild("index");

  assert.deepEqual(
    calls.filter((c) => Array.isArray(c)),
    [
      ["rebuildJob", "traffic_index"],
      ["rebuildJob", "annotation_index"],
    ],
  );
  assert.equal(groupBuilding(get(store), "index"), true);
  store.onJobComplete({ name: "traffic_index" });
  store.onJobComplete({ name: "annotation_index" });
  // The Ledger reloads when a rebuild finishes, so its counts are current.
  assert.deepEqual(finished, ["index"]);
});

test("rebuilding the sitemap rebuilds only the sitemap job", async () => {
  const { store, calls } = setup([allComplete()]);
  await store.rebuild("sitemap");
  assert.deepEqual(
    calls.filter((c) => Array.isArray(c)),
    [["rebuildJob", "sitemap"]],
  );
});

test("a failed read keeps the last jobs and shows the error until a read works", async () => {
  const { store } = setup([[job("sitemap", false)], new Error("db locked"), allComplete()]);
  await store.refresh();
  await store.refresh();
  assert.match(get(store).error, /db locked/);
  assert.equal(get(store).jobs.length, 1);
  await store.reload();
  assert.equal(get(store).error, "");
});

test("clear forgets the project's jobs and the views waiting on them", async () => {
  const { store, finished } = setup([[job("sitemap", false)]]);
  store.watch("sitemap");
  await store.refresh();
  store.clear();
  store.onJobComplete({ name: "sitemap" });
  assert.deepEqual(finished, []);
  // A job the store hasn't read yet waits for the next read.
  assert.deepEqual(get(store).jobs, []);
});

test("job events that arrive while the jobs are read still show", async () => {
  let release;
  const finished = [];
  const store = createJobsStore(
    { listJobs: () => new Promise((resolve) => (release = resolve)), rebuildJob: async () => {} },
    { onFinished: (group) => finished.push(group) },
  );
  store.watch("index");
  // Marasi read the jobs before they finished, and the events came first.
  store.onJobProgress({ name: "traffic_index", done: 5, total: 5 });
  store.onJobComplete({ name: "traffic_index" });
  store.onJobComplete({ name: "annotation_index" });
  release([job("traffic_index", false, 1, 5), job("annotation_index", false)]);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(groupBuilding(get(store), "index"), false);
  assert.deepEqual(finished, ["index"]);
});

test("a read for an earlier project is dropped", async () => {
  let release;
  const api = {
    listJobs: () => new Promise((resolve) => (release = resolve)),
    rebuildJob: async () => {},
  };
  const store = createJobsStore(api);
  const read = store.refresh();
  store.clear();
  release([job("sitemap", false)]);
  await read;
  assert.deepEqual(get(store).jobs, []);
});

test("jobStatus describes each job's state", () => {
  assert.equal(jobStatus(job("sitemap", true, 40, 40)), "Complete");
  assert.equal(jobStatus(job("sitemap", false, 1234, 5000)), "Building · 1,234 of 5,000");
  assert.equal(jobStatus(job("sitemap", false, 0, 0)), "Building");
});

test("prettified copies are moving while the prettified_move job runs", () => {
  assert.equal(groupBuilding({ jobs: [job("prettified_move", false)] }, "prettified"), true);
  assert.equal(groupBuilding({ jobs: [job("prettified_move", true)] }, "prettified"), false);
  // Before the first read nothing is known, so nothing is shown.
  assert.equal(groupBuilding({ jobs: [] }, "prettified"), false);
});

test("the dashboard's intercepted count is counting while the intercepted_count job runs", () => {
  assert.equal(groupBuilding({ jobs: [job("intercepted_count", false)] }, "intercepted"), true);
  assert.equal(groupBuilding({ jobs: [job("intercepted_count", true)] }, "intercepted"), false);
  assert.equal(jobLabel("intercepted_count"), "Intercepted count");
});
