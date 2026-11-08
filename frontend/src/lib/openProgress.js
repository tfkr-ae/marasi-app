// The opening screen's state for one open of a project: the steps, the
// sentence and the progress, built from the service's project.* events, the
// load sequence's part signals and the open's outcome. No Svelte or Wails here:
// this is the opening screen's test seam (see openProgress.test.js).
//
// The state is a plain object; each `with…` function returns a new one, and
// `openingScreen` turns it into what the screen renders.

import { codeIDs } from "./errorCodes.js";

// The open's steps in order. `running` is the label while the step runs,
// `failed` the label once it failed, when it differs from `label`.
const openSteps = [
  { id: "lock", label: "Lock", running: "Locking", failed: "Locked", sentence: "Checking the project lock." },
  { id: "open", label: "Open", running: "Opening", sentence: "Opening the database." },
  { id: "upgrade", label: "Upgrade", running: "Upgrading", sentence: "Upgrading the database. Keep Marasi open." },
  // The service waits for the open project's work (Lua, requests) to end.
  { id: "wait", label: "Wait", running: "Waiting", sentence: "Waiting for the open project." },
  { id: "load", label: "Load", running: "Loading" },
];
const stepIndex = Object.fromEntries(openSteps.map(({ id }, i) => [id, i]));
// The step index past the last step: the open succeeded.
const succeededStep = openSteps.length;

/**
 * The load's signals (projectData.load), one per store in registration
 * order, each reported once every store before it has loaded.
 */
export const loadSignals = Object.freeze({
  traffic: "traffic",
  extensions: "extensions",
  logs: "logs",
  scope: "scope",
  checkpoint: "checkpoint",
  workshop: "workshop",
  waypoints: "waypoints",
  extensionList: "extension-list",
  testCases: "test-cases",
  findings: "findings",
  intercept: "intercept",
  armory: "armory",
  launchpads: "launchpads",
});

// The project's parts, in load order, and the signals each part covers.
const signal = loadSignals;
const loadParts = [
  { label: "Traffic", signals: [signal.traffic] },
  { label: "Extensions", signals: [signal.extensions, signal.logs] },
  {
    label: "Scope & checkpoint",
    signals: [signal.scope, signal.checkpoint, signal.workshop, signal.waypoints, signal.extensionList],
  },
  { label: "Findings & test cases", signals: [signal.testCases, signal.findings, signal.intercept, signal.armory] },
  { label: "Launchpads", signals: [signal.launchpads] },
];
const partOfSignal = new Map(loadParts.flatMap(({ signals }, i) => signals.map((signal) => [signal, i])));

/**
 * Starts the state for opening the project `name` at `path` (null while the
 * full path is unknown). `current` is the project open now, `{name, path}`
 * (path null when unknown), or null at startup. `scratchpad` marks the
 * scratchpad, which startup opens first.
 */
export function openingFor({ name, path = null, current = null, scratchpad = false }) {
  return {
    name,
    path,
    scratchpad,
    current,
    recents: [],
    step: 0,
    upgrade: null,
    waitingFor: [],
    part: 0,
    log: [],
    failure: null,
  };
}

/**
 * Feeds one of the service's project.* events (`name`, its `data`):
 * project.opening, .upgrading, .waiting, .opened and .opening_failed. Events
 * for another project are ignored; an open by name takes its path from the
 * first event for a project of that name. Steps only move forward, and
 * nothing but the failure's reason is taken once the open has ended.
 */
export function withProjectEvent(state, name, data) {
  const project = typeof data?.project === "string" ? data.project : null;
  if (!project || !name?.startsWith("project.")) return state;
  if (state.path ? project !== state.path : projectName(project) !== state.name) return state;
  const path = state.path ?? project;
  const logged = { ...state, path, log: [...state.log, eventLine(name, data)] };
  if (state.step === succeededStep) return state;
  if (state.failure) return name === "project.opening_failed" ? logged : state;

  const at = (id) => Math.max(state.step, stepIndex[id]);
  switch (name) {
    case "project.opening":
      return { ...logged, step: at("open") };
    case "project.upgrading":
      return {
        ...logged,
        step: at("upgrade"),
        upgrade: { file: data.migration, applied: data.applied, total: data.total },
      };
    case "project.waiting":
      return { ...logged, step: at("wait"), waitingFor: data.waiting_for ?? [] };
    case "project.opened":
      return { ...logged, step: at("load") };
    case "project.opening_failed":
      return logged;
    default:
      return state;
  }
}

// One event as a Details line: its name and fields, as sent.
function eventLine(name, data) {
  const fields = Object.entries(data ?? {}).map(([key, value]) => {
    const text = typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
    return ` ${key}=${text}`;
  });
  return `${name}${fields.join("")}`;
}

// What the service waits for, as the Wait step's sentence names it.
function waitName(wait) {
  if (wait.kind === "work") return `${wait.count} request${wait.count === 1 ? "" : "s"}`;
  if (wait.kind === "extension") return wait.name;
  return wait.summary || wait.type || "a held item";
}

/**
 * Feeds the load sequence's signal that `signal` starts loading. Parts
 * only move forward; unknown signals are ignored.
 */
export function withLoadPart(state, signal) {
  const part = partOfSignal.get(signal);
  if (part === undefined || part <= state.part) return state;
  return { ...state, part };
}

/**
 * Records that the service opened the target and released the project
 * open before: from here the open project is the target, even if
 * loading it fails.
 */
export function withSwitched(state) {
  return {
    ...state,
    step: Math.max(state.step, stepIndex.load),
    current: { name: state.name, path: state.path },
  };
}

/** Records that the open succeeded: the project is open and loaded. */
export function withOpened(state) {
  return { ...state, step: succeededStep };
}

/**
 * Records that the open failed with `error`, as the service client reports
 * it. A locked project (the `project_locked` code: another Marasi owns it)
 * fails the Lock step; any other error fails the step that was running.
 */
export function withFailed(state, error) {
  const text = String(error ?? "");
  const locked = codeIDs(text, "project_locked") !== null;
  return {
    ...state,
    step: locked ? stepIndex.lock : Math.min(state.step, stepIndex.load),
    failure: { kind: locked ? "locked" : "other", error: text },
    // Details ends with the error, as returned.
    log: [...state.log, text],
  };
}

/**
 * Feeds the recent projects, `[{name, path, modifiedAt}]` with RFC 3339
 * times (the service's project list), to pick from after a failure. `now`
 * (epoch ms) is when they're listed, for how long ago each opened.
 */
export function withRecents(state, recents, now = Date.now()) {
  const projects = (recents ?? []).map(({ name, path, modifiedAt }) => ({
    name,
    path,
    at: parseTime(modifiedAt),
    opened: openedAgo(modifiedAt, now),
  }));
  // Most recent first; a date that doesn't parse goes last.
  projects.sort((a, b) => (Number.isNaN(b.at) ? -Infinity : b.at) - (Number.isNaN(a.at) ? -Infinity : a.at));
  return { ...state, recents: projects.map(({ name, path, opened }) => ({ name, path, opened })) };
}

/** A project file's name, without its directory or ".marasi". */
export const projectName = (path) =>
  String(path)
    .split(/[\\/]/)
    .pop()
    .replace(/\.marasi$/, "");

// An RFC 3339 time as epoch ms, its fraction cut to milliseconds, which
// every engine parses. NaN when it doesn't match.
function parseTime(text) {
  const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d+))?(Z|[+-]\d\d:\d\d)$/.exec(String(text ?? ""));
  if (!match) return NaN;
  const [, time, fraction = "0", zone] = match;
  return Date.parse(`${time}.${fraction.padEnd(3, "0").slice(0, 3)}${zone}`);
}

// How long before `now` a project last opened, from the RFC 3339 `text`:
// "Just now", "20 minutes ago", "Yesterday", "Last week", up to four weeks,
// then the day it opened ("2026-08-02"). Empty when the time doesn't parse.
function openedAgo(text, now) {
  const at = parseTime(text);
  if (Number.isNaN(at)) return "";
  const minutes = Math.floor(Math.max(0, now - at) / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const ago = (count, unit) => `${count} ${unit}${count === 1 ? "" : "s"} ago`;
  if (minutes < 1) return "Just now";
  if (hours < 1) return ago(minutes, "minute");
  if (days < 1) return ago(hours, "hour");
  if (days === 1) return "Yesterday";
  if (weeks < 1) return ago(days, "day");
  if (weeks === 1) return "Last week";
  if (weeks < 5) return ago(weeks, "week");
  // The day as the service wrote it, in the time zone it was written in.
  return String(text).slice(0, 10);
}

// Whether a recent project is `name` at `path`: by path when both are
// known, else by name (a project opened by name lives in the service's
// projects dir, as every recent project does).
const isProject = (recent, name, path) =>
  recent.path && path ? recent.path === path : recent.name === name;

/** Everything the opening screen renders. */
export function openingScreen(state) {
  const { failure } = state;
  const steps = openSteps.map(({ id, label, running, failed }, i) => {
    let mark = "todo";
    if (i === state.step) mark = failure ? "failed" : "current";
    else if (i < state.step) mark = "done";
    if (mark === "current") return { id, label: running, mark };
    if (mark === "failed") return { id, label: failed ?? label, mark };
    return { id, label, mark };
  });
  const loading = !failure && state.step === stepIndex.load;
  const part = loading ? loadParts[state.part].label : null;
  let sentence = "Opened.";
  if (failure?.kind === "locked") {
    const project = state.scratchpad ? "The scratchpad" : "The project";
    sentence = `${project} is opened by another instance.`;
  }
  else if (failure) sentence = "Couldn't open the project.";
  else if (loading) sentence = `Loading ${part.toLowerCase()}.`;
  else if (state.step === stepIndex.wait && state.waitingFor.length) {
    sentence = `Waiting for ${state.waitingFor.map(waitName).join(", ")}.`;
  } else if (state.step < succeededStep) sentence = openSteps[state.step].sentence;
  return {
    project: { name: state.name, path: state.path },
    // The project that opened, once the open succeeded: what startup and
    // the window title take the project's name from.
    opened: state.step === succeededStep ? { name: state.name, path: state.path } : null,
    steps,
    sentence,
    upgrade: !failure && state.step === stepIndex.upgrade ? state.upgrade : null,
    load: {
      part,
      done: state.step === succeededStep ? loadParts.length : loading ? state.part : 0,
      total: loadParts.length,
    },
    failure,
    // Stay in names the project still open, if any; only a locked project
    // may open on a retry, once the other Marasi lets it go.
    actions: failure ? { stayIn: state.current?.name ?? null, tryAgain: failure.kind === "locked" } : null,
    // With no project open (at startup) there's nothing to stay in, so the
    // list is the way forward.
    choicesLabel: state.current === null ? "Open a project instead" : "Open another project",
    // The projects to open instead, most recent first: the first is the
    // one picked by default. The target and the open project aren't
    // choices.
    choices: state.recents.filter(
      (recent) =>
        !isProject(recent, state.name, state.path) &&
        !(state.current !== null && isProject(recent, state.current.name, state.current.path)),
    ),
    log: state.log,
  };
}
