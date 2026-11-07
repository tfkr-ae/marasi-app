// Marasi's background jobs: polling ListJobs while one runs, telling the
// Ledger and sitemap when the jobs they wait on finish, and rebuilding.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createJobsStore, jobLabel, jobStatus, groupBuilding } from "./createJobsStore.js";
import { progressJob } from "./jobsApi.js";

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
// repeats), and a manual timer: run() fires the pending poll.
function setup(answers, { onFinished = () => {} } = {}) {
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
  let pending = null;
  const timer = {
    schedule: (fn, ms) => {
      pending = { fn, ms };
      return pending;
    },
    cancel: (handle) => {
      if (pending === handle) pending = null;
    },
    get pending() {
      return pending;
    },
    async run() {
      const p = pending;
      pending = null;
      await p.fn();
    },
  };
  const finished = [];
  const store = createJobsStore(api, {
    timer,
    onFinished: (group) => {
      finished.push(group);
      onFinished(group);
    },
  });
  return { store, api, calls, timer, finished };
}

test("refresh lists the jobs and stops polling once all are complete", async () => {
  const { store, timer } = setup([allComplete()]);

  await store.refresh();

  assert.deepEqual(
    get(store).jobs.map((j) => j.Name),
    ["traffic_index", "annotation_index", "sitemap", "prettified_move"],
  );
  assert.equal(timer.pending, null);
});

test("polls gently while a job is incomplete, until it finishes", async () => {
  const running = [job("traffic_index", false, 10, 40), ...allComplete().slice(1)];
  const { store, timer, calls } = setup([running, running, allComplete()]);

  await store.refresh();
  assert.ok(timer.pending, "wanted another poll");
  assert.ok(timer.pending.ms >= 1000, "wanted a gentle interval");
  assert.equal(groupBuilding(get(store), "index"), true);

  await timer.run();
  await timer.run();

  assert.equal(calls.filter((c) => c === "listJobs").length, 3);
  assert.equal(groupBuilding(get(store), "index"), false);
  assert.equal(timer.pending, null);
});

test("tells the view that saw a group incomplete when its jobs finish", async () => {
  const sitemapRunning = [...allComplete().slice(0, 2), job("sitemap", false), allComplete()[3]];
  const { store, timer, finished } = setup([sitemapRunning, allComplete()]);

  store.watch("sitemap");
  await timer.run();
  assert.deepEqual(finished, []);
  await timer.run();

  assert.deepEqual(finished, ["sitemap"]);
  assert.equal(timer.pending, null);
});

test("a watched group that is already complete finishes on the next read", async () => {
  const { store, timer, finished } = setup([allComplete()]);

  store.watch("index");
  store.watch("index");
  await timer.run();

  assert.deepEqual(finished, ["index"]);
  assert.equal(timer.pending, null);
});

test("does not tell a view about a group it did not watch", async () => {
  const running = [job("traffic_index", false), ...allComplete().slice(1)];
  const { store, timer, finished } = setup([running, allComplete()]);

  await store.refresh();
  await timer.run();

  assert.deepEqual(finished, []);
});

test("rebuilding the search index rebuilds both index jobs and polls their progress", async () => {
  const rebuilt = [job("traffic_index", false), job("annotation_index", false), ...allComplete().slice(2)];
  const { store, calls, timer, finished } = setup([rebuilt, allComplete()]);

  await store.rebuild("index");

  assert.deepEqual(
    calls.filter((c) => Array.isArray(c)),
    [
      ["rebuildJob", "traffic_index"],
      ["rebuildJob", "annotation_index"],
    ],
  );
  assert.equal(groupBuilding(get(store), "index"), true);
  await timer.run();
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

test("a failed read keeps the last jobs, shows the error and retries", async () => {
  const running = [job("sitemap", false)];
  const { store, timer } = setup([running, new Error("db locked"), allComplete()]);

  await store.refresh();
  await timer.run();

  assert.match(get(store).error, /db locked/);
  assert.equal(get(store).jobs.length, 1);
  assert.ok(timer.pending, "wanted a retry");
  await timer.run();
  assert.equal(get(store).error, "");
});

test("clear stops polling and forgets the project's jobs", async () => {
  const running = [job("sitemap", false)];
  const { store, timer, finished } = setup([running]);

  store.watch("sitemap");
  await store.refresh();
  store.clear();

  assert.equal(timer.pending, null);
  assert.deepEqual(get(store).jobs, []);
  assert.deepEqual(finished, []);
});

test("a read for an earlier project is dropped", async () => {
  let release;
  const api = {
    listJobs: () => new Promise((resolve) => (release = resolve)),
    rebuildJob: async () => {},
  };
  const store = createJobsStore(api, { timer: { schedule: () => ({}), cancel: () => {} } });

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

test("job.progress shows the running job's progress at once, without a read", async () => {
  const { store, calls } = setup([allComplete()]);
  await store.refresh();
  store.onProgress(progressJob({ name: "sitemap", project: "/p/x.marasi", done: 40, total: 200 }));
  const sitemap = get(store).jobs.find((j) => j.Name === "sitemap");
  assert.equal(jobStatus(sitemap), `Building · 40 of 200`);
  assert.equal(groupBuilding(get(store), "sitemap"), true);
  assert.deepEqual(calls, ["listJobs"]);
});

test("job.progress for a job not listed yet adds it", () => {
  const { store } = setup([allComplete()]);
  store.onProgress(progressJob({ name: "traffic_index", project: "/p/x.marasi", done: 1, total: 3 }));
  assert.deepEqual(get(store).jobs, [job("traffic_index", false, 1, 3, true)]);
});
