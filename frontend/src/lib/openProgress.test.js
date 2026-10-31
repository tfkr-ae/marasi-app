import { test } from "node:test";
import assert from "node:assert/strict";
import {
  openingFor,
  openingScreen,
  recentProjects as listRecent,
  withFailed,
  withLoadPart,
  withOpened,
  withOpening,
  withOwner,
  withRecents,
  withSwitched,
  withUpgrading,
  withWaiting,
} from "./openProgress.js";

// The opening screen's steps as "label:mark" pairs, for compact assertions.
const marks = (state) => openingScreen(state).steps.map((step) => `${step.label}:${step.mark}`);

const acme = () => openingFor({ name: "acme-portal", path: "/Users/r/acme-portal.marasi", current: { name: "scratchpad", path: null } });
// Marasi's project.upgrading payload for one applied migration.
const upgrade = (migration, applied, total) => ({ project: "/Users/r/acme-portal.marasi", migration, applied, total });

test("an open starts by opening the project, under the project's name and path", () => {
  const screen = openingScreen(acme());

  assert.deepEqual(screen.project, { name: "acme-portal", path: "/Users/r/acme-portal.marasi" });
  assert.deepEqual(marks(acme()), ["Opening:current", "Upgrade:todo", "Wait:todo", "Load:todo"]);
  assert.equal(screen.sentence, "Opening the database.");
});

test("an open by bare name takes the project's path from project.opening", () => {
  const state = openingFor({ name: "new-target", path: null, current: { name: "scratchpad", path: null } });
  assert.equal(openingScreen(state).project.path, null);

  const opening = withOpening(state, { project: "/cfg/Marasi/projects/new-target.marasi" });
  assert.deepEqual(openingScreen(opening).project, { name: "new-target", path: "/cfg/Marasi/projects/new-target.marasi" });
});

test("a database upgrade shows the running migration as applied of total", () => {
  const first = withUpgrading(acme(), upgrade("00001_init.sql", 1, 27));
  assert.deepEqual(marks(first), ["Open:done", "Upgrading:current", "Wait:todo", "Load:todo"]);
  assert.equal(openingScreen(first).sentence, "Upgrading the database. Keep Marasi open.");
  assert.deepEqual(openingScreen(first).upgrade, { migration: "00001_init.sql", applied: 1, total: 27 });

  const later = withUpgrading(first, upgrade("00027_scope.sql", 27, 27));
  assert.deepEqual(openingScreen(later).upgrade, { migration: "00027_scope.sql", applied: 27, total: 27 });
});

test("a switch waiting on held Checkpoint items says what it waits for and offers Checkpoint", () => {
  const state = withWaiting(withUpgrading(acme(), upgrade("00027_scope.sql", 27, 27)), {
    project: "/Users/r/acme-portal.marasi",
    waiting_for: [
      { kind: "checkpoint", id: "a1", type: "request", summary: "GET https://acme.test/login HTTP/1.1" },
      { kind: "checkpoint", id: "b2", type: "websocket", summary: "outgoing" },
      { kind: "extension", name: "workshop" },
      { kind: "work", count: 3 },
    ],
  });
  const screen = openingScreen(state);

  assert.deepEqual(marks(state), ["Open:done", "Upgrade:done", "Waiting:current", "Load:todo"]);
  assert.equal(screen.sentence, "Waiting for 2 held Checkpoint items.");
  assert.deepEqual(screen.waiting, {
    items: [
      "Held request: GET https://acme.test/login HTTP/1.1",
      "Held websocket: outgoing",
      "Extension workshop running",
      "3 other calls finishing",
    ],
    checkpoint: true,
  });
  assert.equal(screen.upgrade, null);
});

test("a switch waiting only on running work says so, without Checkpoint", () => {
  const state = withWaiting(acme(), { waiting_for: [{ kind: "work", count: 1 }] });

  assert.equal(openingScreen(state).sentence, "Waiting for running work to finish.");
  assert.deepEqual(openingScreen(state).waiting, { items: ["1 other call finishing"], checkpoint: false });
});

test("a newer wait list replaces the last, and the wait ends once the project is switched", () => {
  const held = withWaiting(acme(), { waiting_for: [{ kind: "checkpoint", type: "request", summary: "GET / HTTP/1.1" }] });
  const fewer = withWaiting(held, { waiting_for: [{ kind: "work", count: 2 }] });
  assert.deepEqual(openingScreen(fewer).waiting.items, ["2 other calls finishing"]);

  const switched = withSwitched(fewer);
  assert.deepEqual(marks(switched), ["Open:done", "Upgrade:done", "Wait:done", "Loading:current"]);
  assert.equal(openingScreen(switched).waiting, null);
});

test("the Load step says which part of the project is loading and how many of the five are done", () => {
  const ready = withSwitched(acme());
  assert.equal(openingScreen(ready).sentence, "Loading traffic.");
  assert.deepEqual(openingScreen(ready).load, { part: "Traffic", done: 0, total: 5 });

  const load = (...parts) => openingScreen(parts.reduce(withLoadPart, ready));
  assert.deepEqual(load("traffic").load, { part: "Traffic", done: 0, total: 5 });
  assert.deepEqual(load("traffic", "extensions").load, { part: "Extensions", done: 1, total: 5 });
  assert.equal(load("traffic", "extensions", "logs").load.part, "Extensions");
  assert.deepEqual(load("traffic", "extensions", "logs", "scope").load, { part: "Scope & checkpoint", done: 2, total: 5 });
  assert.equal(load("traffic", "extensions", "logs", "scope").sentence, "Loading scope & checkpoint.");
  assert.deepEqual(load("scope", "checkpoint", "workshop", "waypoints", "extension-list").load.done, 2);
  assert.deepEqual(load("test-cases", "findings", "intercept", "armory").load, {
    part: "Findings & test cases",
    done: 3,
    total: 5,
  });
  assert.deepEqual(load("launchpads").load, { part: "Launchpads", done: 4, total: 5 });
  assert.equal(load("launchpads").sentence, "Loading launchpads.");
});

test("a part signalled before the switch doesn't skip ahead, and parts never move back", () => {
  assert.deepEqual(marks(withLoadPart(acme(), "traffic")), ["Opening:current", "Upgrade:todo", "Wait:todo", "Load:todo"]);
  const ready = withSwitched(acme());
  assert.equal(openingScreen(["scope", "traffic"].reduce(withLoadPart, ready)).load.part, "Scope & checkpoint");
});

test("a quick open ends with every step ticked and the sentence Opened.", () => {
  const state = withOpened(withSwitched(acme()));

  assert.deepEqual(marks(state), ["Open:done", "Upgrade:done", "Wait:done", "Load:done"]);
  assert.equal(openingScreen(state).sentence, "Opened.");
  assert.equal(openingScreen(state).upgrade, null);
  assert.deepEqual(openingScreen(state).load, { part: null, done: 5, total: 5 });
});

test("events after the open succeeded or failed aren't part of it", () => {
  const opened = withOpened(withSwitched(acme()));
  assert.deepEqual(marks(withUpgrading(opened, upgrade("00001_init.sql", 1, 27))), marks(opened));
  const failed = withFailed(acme(), "boom");
  assert.deepEqual(marks(withWaiting(failed, { waiting_for: [{ kind: "work", count: 1 }] })), marks(failed));
});

test("Details lists the open's events in order", () => {
  const state = withWaiting(
    withUpgrading(withOpening(acme(), { project: "/Users/r/acme-portal.marasi" }), upgrade("00001_init.sql", 1, 27)),
    { waiting_for: [{ kind: "checkpoint", type: "request", summary: "GET / HTTP/1.1" }] },
  );

  assert.deepEqual(openingScreen(state).log, [
    "Opening /Users/r/acme-portal.marasi",
    "Upgrade 1 of 27: 00001_init.sql",
    "Waiting for: Held request: GET / HTTP/1.1",
  ]);
});

// The locked refusal, as the POST answers it and as project.opening_failed
// carries it.
const lockedError = "POST /project/open: project_already_open: HTTP 409";
const lockedEvent = "project already open: /Users/r/acme-portal.marasi";

test("a locked project opened by bare name takes its path from project.opening_failed", () => {
  const state = openingFor({ name: "acme-portal", path: null, current: { name: "scratchpad", path: null } });

  assert.deepEqual(openingScreen(withFailed(state, lockedEvent)).project, {
    name: "acme-portal",
    path: "/Users/r/acme-portal.marasi",
  });
});

test("a locked project fails Open as Locked, says it's opened by another instance, and offers Stay in and Try again", () => {
  for (const error of [lockedError, lockedEvent]) {
    const state = withFailed(acme(), error);
    const screen = openingScreen(state);

    assert.deepEqual(marks(state), ["Locked:failed", "Upgrade:todo", "Wait:todo", "Load:todo"]);
    assert.equal(screen.sentence, "The project is opened by another instance.");
    assert.deepEqual(screen.failure, { kind: "locked", error });
    assert.deepEqual(screen.actions, { stayIn: "scratchpad", tryAgain: true, owner: null });
  }
});

test("a locked project whose owner is a local instance names it and offers to connect to it", () => {
  const state = withOwner(withFailed(acme(), lockedError), "acme");
  const screen = openingScreen(state);

  assert.equal(screen.sentence, "The project is open on acme.");
  assert.deepEqual(screen.actions, { stayIn: "scratchpad", tryAgain: true, owner: "acme" });
});

test("another failure fails the step that was running, offers Stay in but no Try again, and puts the raw error in the log", () => {
  const error = "file is not a database (26)";
  const state = withFailed(acme(), error);
  const screen = openingScreen(state);

  assert.deepEqual(marks(state), ["Open:failed", "Upgrade:todo", "Wait:todo", "Load:todo"]);
  assert.equal(screen.sentence, "Couldn't open the project.");
  assert.deepEqual(screen.failure, { kind: "other", error });
  assert.deepEqual(screen.actions, { stayIn: "scratchpad", tryAgain: false, owner: null });
  assert.equal(screen.log.at(-1), error);
  assert.equal(screen.load.part, null);
});

test("a failed upgrade fails Upgrade, and stops showing upgrade progress", () => {
  const upgrading = withUpgrading(acme(), upgrade("00022_pair_number.sql", 22, 27));
  const state = withFailed(upgrading, "opening project database: migrating: disk full");

  assert.deepEqual(marks(state), ["Open:done", "Upgrade:failed", "Wait:todo", "Load:todo"]);
  assert.equal(openingScreen(state).upgrade, null);
});

test("Marasi's failure text replaces the POST's, which only has the code", () => {
  const posted = withFailed(acme(), "POST /project/open: internal_server_error: HTTP 500");
  const state = withFailed(posted, "opening project database: migrating: disk full");

  assert.equal(openingScreen(state).failure.error, "opening project database: migrating: disk full");
  assert.equal(openingScreen(withFailed(state, "POST /project/open: internal_server_error: HTTP 500")).failure.error,
    "opening project database: migrating: disk full");
});

// The instance's projects as GET /project/list returns them: sorted by
// name, with each file's modification time in UTC.
const cfg = "/Users/r/Library/Application Support/Marasi/projects";
const item = (name, modified_at) => ({ name, project: `${cfg}/${name}.marasi`, modified_at });
const recentProjects = [
  item("acme-portal", "2026-10-20T03:00:00Z"),
  item("ai-sec", "2026-10-19T13:03:44.25Z"),
  item("build", "2026-10-18T05:12:01.5Z"),
  item("car", "2026-10-01T10:00:00.1Z"),
  item("scratchpad", "2026-10-20T04:40:21.123456789Z"),
];
const names = (state) => openingScreen(state).choices.map((choice) => choice.name);

test("the recent projects to pick from leave out the target and the open project, most recent first", () => {
  const state = openingFor({
    name: "acme-portal",
    path: `${cfg}/acme-portal.marasi`,
    current: { name: "scratchpad", path: `${cfg}/scratchpad.marasi` },
  });
  const failed = withRecents(withFailed(state, lockedError), recentProjects);

  assert.deepEqual(names(failed), ["ai-sec", "build", "car"]);
  assert.equal(openingScreen(failed).choices[0].name, "ai-sec");
  assert.equal(openingScreen(failed).choices[0].path, `${cfg}/ai-sec.marasi`);
});

// The moment the opening screen lists recent projects: 08:40:21 at +04.
const now = Date.parse("2026-10-20T04:40:21Z");
const openedTimes = (state) => Object.fromEntries(openingScreen(state).choices.map((choice) => [choice.name, choice.opened]));

test("each recent project says when it was last opened", () => {
  const recents = [
    ...recentProjects,
    item("old", "2026-08-02T07:00:00Z"),
    item("odd", "last Tuesday"),
  ];
  const state = withRecents(openingFor({ name: "target", path: `${cfg}/target.marasi` }), recents, now);

  assert.deepEqual(openedTimes(state), {
    scratchpad: "Just now",
    "acme-portal": "1 hour ago",
    "ai-sec": "15 hours ago",
    build: "Yesterday",
    car: "2 weeks ago",
    old: "2026-08-02",
    odd: "",
  });
});

test("a project opened a few minutes or days ago, or last week, says so", () => {
  const at = (date) => [item("p", date)];
  const opened = (date) => openingScreen(withRecents(openingFor({ name: "target" }), at(date), now)).choices[0].opened;

  assert.equal(opened("2026-10-20T04:39:00Z"), "1 minute ago");
  assert.equal(opened("2026-10-20T04:20:00Z"), "20 minutes ago");
  assert.equal(opened("2026-10-17T04:00:00Z"), "3 days ago");
  assert.equal(opened("2026-10-11T04:00:00Z"), "Last week");
});

test("the project picker lists the instance's projects newest first, each with when it was last opened", () => {
  assert.deepEqual(
    listRecent(recentProjects, now).map(({ name, path, opened }) => [name, path, opened]),
    [
      ["scratchpad", `${cfg}/scratchpad.marasi`, "Just now"],
      ["acme-portal", `${cfg}/acme-portal.marasi`, "1 hour ago"],
      ["ai-sec", `${cfg}/ai-sec.marasi`, "15 hours ago"],
      ["build", `${cfg}/build.marasi`, "Yesterday"],
      ["car", `${cfg}/car.marasi`, "2 weeks ago"],
    ],
  );
});

test("a target or open project with no known path is left out of the list by name", () => {
  const state = openingFor({ name: "acme-portal", path: null, current: { name: "scratchpad", path: null } });

  assert.deepEqual(names(withRecents(state, recentProjects)), ["ai-sec", "build", "car"]);
});

test("a project that shares the open project's name elsewhere stays in the list", () => {
  const state = openingFor({
    name: "acme-portal",
    path: `${cfg}/acme-portal.marasi`,
    current: { name: "build", path: "/Users/r/Engagements/build.marasi" },
  });

  assert.deepEqual(names(withRecents(state, recentProjects)), ["scratchpad", "ai-sec", "build", "car"]);
});

test("there's nothing to pick from until the recent projects arrive", () => {
  assert.deepEqual(openingScreen(withFailed(acme(), lockedError)).choices, []);
});

test("once the target's database is open the previous project is gone, so a failed load offers Stay in the target", () => {
  const loading = withSwitched(acme());
  const state = withFailed(withLoadPart(loading, "extensions"), "loading extensions: boom");

  assert.deepEqual(marks(state), ["Open:done", "Upgrade:done", "Wait:done", "Load:failed"]);
  assert.deepEqual(openingScreen(state).actions, { stayIn: "acme-portal", tryAgain: false, owner: null });
});

test("an open in progress has no failure and offers no actions", () => {
  assert.equal(openingScreen(acme()).failure, null);
  assert.equal(openingScreen(acme()).actions, null);
});

// At startup nothing is open yet, and the app opens the scratchpad first.
const scratchpad = () => openingFor({ name: "scratchpad", scratchpad: true });
const lockedScratchpad = `project already open: ${cfg}/scratchpad.marasi`;

test("a locked scratchpad at startup says the scratchpad is opened by another instance, offers Try again but no Stay in, and a project instead", () => {
  const state = withRecents(withFailed(scratchpad(), lockedScratchpad), recentProjects);
  const screen = openingScreen(state);

  assert.deepEqual(marks(state), ["Locked:failed", "Upgrade:todo", "Wait:todo", "Load:todo"]);
  assert.equal(screen.sentence, "The scratchpad is opened by another instance.");
  assert.deepEqual(screen.actions, { stayIn: null, tryAgain: true, owner: null });
  assert.equal(screen.choicesLabel, "Open a project instead");
  assert.deepEqual(names(state), ["acme-portal", "ai-sec", "build", "car"]);
});

test("any other scratchpad failure at startup says it couldn't open, with the same list and neither Stay in nor Try again", () => {
  const state = withFailed(scratchpad(), "file is not a database (26)");
  const screen = openingScreen(state);

  assert.equal(screen.sentence, "Couldn't open the project.");
  assert.deepEqual(screen.actions, { stayIn: null, tryAgain: false, owner: null });
  assert.equal(screen.choicesLabel, "Open a project instead");
});

test("at startup, a project picked after a locked scratchpad is the one reported as opened, not the scratchpad", () => {
  const failed = withRecents(withFailed(scratchpad(), lockedScratchpad), recentProjects);
  const picked = openingScreen(failed).choices[0];
  assert.equal(openingScreen(failed).opened, null);

  // The picked project opens like any other, with nothing open before it.
  const opening = openingFor({ name: picked.name, path: picked.path });
  assert.equal(openingScreen(opening).opened, null);
  const state = withOpened(withSwitched(opening));

  assert.deepEqual(openingScreen(state).opened, { name: "acme-portal", path: `${cfg}/acme-portal.marasi` });
});

test("with a project open, the list offers another project", () => {
  assert.equal(openingScreen(withFailed(acme(), lockedError)).choicesLabel, "Open another project");
});
