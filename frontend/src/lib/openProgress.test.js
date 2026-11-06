import { test } from "node:test";
import assert from "node:assert/strict";
import {
  openingFor,
  openingScreen,
  withFailed,
  withLoadPart,
  withOpened,
  withProjectEvent,
  withRecents,
  withSwitched,
} from "./openProgress.js";

// The opening screen's steps as "label:mark" pairs, for compact assertions.
const marks = (state) => openingScreen(state).steps.map((step) => `${step.label}:${step.mark}`);

// The service's project.* events while a project opens, as [name, data].
const target = "/Users/r/acme-portal.marasi";
const opening = (project = target) => ["project.opening", { project }];
const upgrading = (migration, applied, total, project = target) => [
  "project.upgrading",
  { project, migration, applied, total },
];
const waiting = (waiting_for, project = target) => ["project.waiting", { project, waiting_for }];
const opened = (project = target) => ["project.opened", { project }];
const openingFailed = (error, project = target) => ["project.opening_failed", { project, error }];

const replay = (state, events) => events.reduce((next, [name, data]) => withProjectEvent(next, name, data), state);
const acme = () => openingFor({ name: "acme-portal", path: target, current: { name: "scratchpad", path: null } });

test("an open starts by checking the project lock, under the project's name and path", () => {
  const screen = openingScreen(acme());

  assert.deepEqual(screen.project, { name: "acme-portal", path: target });
  assert.deepEqual(marks(acme()), ["Locking:current", "Open:todo", "Upgrade:todo", "Wait:todo", "Load:todo"]);
  assert.equal(screen.sentence, "Checking the project lock.");
});

test("the service starting the open means the lock is being taken and the database opened", () => {
  const state = replay(acme(), [opening()]);

  assert.deepEqual(marks(state), ["Lock:done", "Opening:current", "Upgrade:todo", "Wait:todo", "Load:todo"]);
  assert.equal(openingScreen(state).sentence, "Opening the database.");
});

test("a database upgrade shows the running migration and how many of the total have applied", () => {
  const first = replay(acme(), [opening(), upgrading("00022_pair_number.sql", 1, 3)]);
  assert.deepEqual(marks(first), ["Lock:done", "Open:done", "Upgrading:current", "Wait:todo", "Load:todo"]);
  assert.equal(openingScreen(first).sentence, "Upgrading the database. Keep Marasi open.");
  assert.deepEqual(openingScreen(first).upgrade, { file: "00022_pair_number.sql", applied: 1, total: 3 });

  const third = replay(first, [upgrading("00023_dashboard_counts.sql", 2, 3), upgrading("00025_launchpad_entry_order.go", 3, 3)]);
  assert.deepEqual(openingScreen(third).upgrade, { file: "00025_launchpad_entry_order.go", applied: 3, total: 3 });
});

test("the service waiting on the open project's work says what it waits for", () => {
  const state = replay(acme(), [
    opening(),
    waiting([
      { kind: "extension", name: "compass" },
      { kind: "work", count: 2 },
      { kind: "checkpoint", id: "c1", type: "request", summary: "GET /login HTTP/1.1" },
    ]),
  ]);

  assert.deepEqual(marks(state), ["Lock:done", "Open:done", "Upgrade:done", "Waiting:current", "Load:todo"]);
  assert.equal(openingScreen(state).sentence, "Waiting for compass, 2 requests, GET /login HTTP/1.1.");
  assert.equal(openingScreen(state).upgrade, null);
});

test("one request waited on reads in the singular", () => {
  const state = replay(acme(), [waiting([{ kind: "work", count: 1 }])]);
  assert.equal(openingScreen(state).sentence, "Waiting for 1 request.");
});

test("the service having opened the project moves on to Load", () => {
  const state = replay(acme(), [opening(), upgrading("00022_pair_number.sql", 1, 1), opened()]);

  assert.deepEqual(marks(state), ["Lock:done", "Open:done", "Upgrade:done", "Wait:done", "Loading:current"]);
  assert.equal(openingScreen(state).upgrade, null);
});

const upToDate = [opening(), opened()];

test("the Load step says which part of the project is loading and how many of the five are done", () => {
  const ready = replay(acme(), upToDate);
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

test("a part signalled before the project is open doesn't skip ahead, and parts never move back", () => {
  assert.deepEqual(marks(withLoadPart(acme(), "traffic")), ["Locking:current", "Open:todo", "Upgrade:todo", "Wait:todo", "Load:todo"]);
  const ready = replay(acme(), upToDate);
  assert.equal(openingScreen(["scope", "traffic"].reduce(withLoadPart, ready)).load.part, "Scope & checkpoint");
});

test("a quick open ends with every step ticked and the sentence Opened.", () => {
  const state = withOpened(replay(acme(), upToDate));

  assert.deepEqual(marks(state), ["Lock:done", "Open:done", "Upgrade:done", "Wait:done", "Load:done"]);
  assert.equal(openingScreen(state).sentence, "Opened.");
  assert.deepEqual(openingScreen(state).load, { part: null, done: 5, total: 5 });
});

test("an open that succeeds before any event still ends with every step ticked", () => {
  assert.deepEqual(marks(withOpened(acme())), ["Lock:done", "Open:done", "Upgrade:done", "Wait:done", "Load:done"]);
});

test("events arriving after the service answered never move a step back", () => {
  const state = replay(withSwitched(acme()), [opening(), upgrading("00022_pair_number.sql", 1, 1)]);

  assert.deepEqual(marks(state), ["Lock:done", "Open:done", "Upgrade:done", "Wait:done", "Loading:current"]);
  assert.equal(openingScreen(state).upgrade, null);
});

test("events for another project, and events after the open succeeded, aren't part of it", () => {
  const other = replay(acme(), [opening("/Users/r/other.marasi"), upgrading("00022_pair_number.sql", 1, 1, "/Users/r/other.marasi")]);
  assert.deepEqual(marks(other), ["Locking:current", "Open:todo", "Upgrade:todo", "Wait:todo", "Load:todo"]);
  assert.deepEqual(openingScreen(other).log, []);

  const done = withOpened(replay(acme(), upToDate));
  const later = replay(done, [opening()]);
  assert.equal(openingScreen(later).log.length, 2);
});

test("Details lists the open's events in order, with their fields", () => {
  const state = replay(acme(), [
    opening(),
    upgrading("00022_pair_number.sql", 1, 2),
    waiting([{ kind: "work", count: 2 }]),
    openingFailed("disk full"),
  ]);

  assert.deepEqual(openingScreen(state).log, [
    `project.opening project=${target}`,
    `project.upgrading project=${target} migration=00022_pair_number.sql applied=1 total=2`,
    `project.waiting project=${target} waiting_for=[{"kind":"work","count":2}]`,
    `project.opening_failed project=${target} error=disk full`,
  ]);
});

test("an open by name takes the project's path from the service's first event for that name", () => {
  const state = openingFor({ name: "new-target", path: null, current: { name: "scratchpad", path: null } });
  assert.equal(openingScreen(state).project.path, null);

  const elsewhere = replay(state, [opening("/cfg/projects/other.marasi")]);
  assert.equal(openingScreen(elsewhere).project.path, null);
  const started = replay(state, [opening("/cfg/projects/new-target.marasi")]);
  assert.deepEqual(openingScreen(started).project, { name: "new-target", path: "/cfg/projects/new-target.marasi" });
});

// A locked project as the service client reports it: 409 project_already_open
// renamed to project_locked, with no message.
const lockedError = "POST /project/open: project_locked: HTTP 409";

test("a locked project fails the Lock step as Locked, says it's opened by another instance, and offers Stay in and Try again", () => {
  const state = withFailed(replay(acme(), [opening(), openingFailed(`project already open: ${target}`)]), lockedError);
  const screen = openingScreen(state);

  assert.deepEqual(marks(state), ["Locked:failed", "Open:todo", "Upgrade:todo", "Wait:todo", "Load:todo"]);
  assert.equal(screen.sentence, "The project is opened by another instance.");
  assert.deepEqual(screen.failure, { kind: "locked", error: lockedError });
  assert.deepEqual(screen.actions, { stayIn: "scratchpad", tryAgain: true });
});

test("the service's reason for a failure reaches Details even when it arrives after the refusal", () => {
  const state = replay(withFailed(replay(acme(), [opening()]), lockedError), [openingFailed(`project already open: ${target}`)]);

  assert.deepEqual(openingScreen(state).log, [
    `project.opening project=${target}`,
    lockedError,
    `project.opening_failed project=${target} error=project already open: ${target}`,
  ]);
  assert.deepEqual(marks(state), ["Locked:failed", "Open:todo", "Upgrade:todo", "Wait:todo", "Load:todo"]);
});

test("another failure fails the step that was running, offers Stay in but no Try again, and puts the raw error in the log", () => {
  const error = "POST /project/open: internal_server_error: HTTP 500";
  const state = withFailed(replay(acme(), [opening()]), error);
  const screen = openingScreen(state);

  assert.deepEqual(marks(state), ["Lock:done", "Open:failed", "Upgrade:todo", "Wait:todo", "Load:todo"]);
  assert.equal(screen.sentence, "Couldn't open the project.");
  assert.deepEqual(screen.failure, { kind: "other", error });
  assert.deepEqual(screen.actions, { stayIn: "scratchpad", tryAgain: false });
  assert.equal(screen.log.at(-1), error);
  assert.equal(screen.load.part, null);
});

test("a failed upgrade fails Upgrade, and stops showing upgrade progress", () => {
  const state = withFailed(replay(acme(), [opening(), upgrading("00022_pair_number.sql", 1, 2)]), "migrating: disk full");

  assert.deepEqual(marks(state), ["Lock:done", "Open:done", "Upgrade:failed", "Wait:todo", "Load:todo"]);
  assert.equal(openingScreen(state).upgrade, null);
});

// Recent projects as the project store lists them from the service's
// GET /project/list: its named projects, with RFC 3339 modification times.
const cfg = "/Users/r/Library/Application Support/Marasi/projects";
const recent = (name, modifiedAt) => ({ name, path: `${cfg}/${name}.marasi`, modifiedAt });
const recentProjects = [
  recent("build", "2026-10-18T09:12:01.5+04:00"),
  recent("scratchpad", "2026-10-20T08:40:21.123456789+04:00"),
  recent("ai-sec", "2026-10-19T17:03:44.25+04:00"),
  recent("acme-portal", "2026-10-20T07:00:00+04:00"),
  recent("car", "2026-10-01T10:00:00.1Z"),
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
    recent("old", "2026-08-02T11:00:00+04:00"),
    recent("odd", "last Tuesday"),
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
  const at = (date) => [recent("p", date)];
  const opened = (date) => openingScreen(withRecents(openingFor({ name: "target" }), at(date), now)).choices[0].opened;

  assert.equal(opened("2026-10-20T08:39:00+04:00"), "1 minute ago");
  assert.equal(opened("2026-10-20T08:20:00+04:00"), "20 minutes ago");
  assert.equal(opened("2026-10-17T08:00:00+04:00"), "3 days ago");
  assert.equal(opened("2026-10-11T08:00:00+04:00"), "Last week");
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
  const loading = withSwitched(replay(acme(), upToDate));
  const state = withFailed(withLoadPart(loading, "extensions"), "loading extensions: boom");

  assert.deepEqual(marks(state), ["Lock:done", "Open:done", "Upgrade:done", "Wait:done", "Load:failed"]);
  assert.deepEqual(openingScreen(state).actions, { stayIn: "acme-portal", tryAgain: false });
});

test("an open in progress has no failure and offers no actions", () => {
  assert.equal(openingScreen(acme()).failure, null);
  assert.equal(openingScreen(acme()).actions, null);
});

// At startup nothing is open yet, and the app opens the scratchpad first.
const scratchpad = () => openingFor({ name: "scratchpad", scratchpad: true });
const lockedScratchpad = lockedError;

test("a locked scratchpad at startup says the scratchpad is opened by another instance, offers Try again but no Stay in, and a project instead", () => {
  const state = withRecents(withFailed(scratchpad(), lockedScratchpad), recentProjects);
  const screen = openingScreen(state);

  assert.deepEqual(marks(state), ["Locked:failed", "Open:todo", "Upgrade:todo", "Wait:todo", "Load:todo"]);
  assert.equal(screen.sentence, "The scratchpad is opened by another instance.");
  assert.deepEqual(screen.actions, { stayIn: null, tryAgain: true });
  assert.equal(screen.choicesLabel, "Open a project instead");
  assert.deepEqual(names(state), ["acme-portal", "ai-sec", "build", "car"]);
});

test("any other scratchpad failure at startup says it couldn't open, with the same list and neither Stay in nor Try again", () => {
  const state = withFailed(replay(scratchpad(), [opening(`${cfg}/scratchpad.marasi`)]), "file is not a database (26)");
  const screen = openingScreen(state);

  assert.equal(screen.sentence, "Couldn't open the project.");
  assert.deepEqual(screen.actions, { stayIn: null, tryAgain: false });
  assert.equal(screen.choicesLabel, "Open a project instead");
});

test("at startup, a project picked after a locked scratchpad is the one reported as opened, not the scratchpad", () => {
  const failed = withRecents(withFailed(scratchpad(), lockedScratchpad), recentProjects);
  const picked = openingScreen(failed).choices[0];
  assert.equal(openingScreen(failed).opened, null);

  // The picked project opens like any other, with nothing open before it.
  const opening = openingFor({ name: picked.name, path: picked.path });
  assert.equal(openingScreen(opening).opened, null);
  const state = withOpened(withSwitched(replay(opening, upToDate)));

  assert.deepEqual(openingScreen(state).opened, { name: "acme-portal", path: `${cfg}/acme-portal.marasi` });
});

test("with a project open, the list offers another project", () => {
  assert.equal(openingScreen(withFailed(acme(), lockedError)).choicesLabel, "Open another project");
});
