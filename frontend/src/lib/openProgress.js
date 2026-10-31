// The opening screen's state for one open of a project: the steps, the
// sentence and the progress, built from Marasi's project.* events, the load
// sequence's part signals and the open's outcome. No Svelte or bindings
// here: this is the opening screen's test seam (see openProgress.test.js).
//
// The state is a plain object; each `with…` function returns a new one, and
// `openingScreen` turns it into what the screen renders.

import { codeIDs } from "./errorCodes.js";

// The open's steps in order. `running` is the label while the step runs;
// a locked project fails Open as Locked.
// Open covers the project lock too: Marasi reports nothing between them.
const openSteps = [
  { id: "open", label: "Open", running: "Opening", sentence: "Opening the database." },
  { id: "upgrade", label: "Upgrade", running: "Upgrading", sentence: "Upgrading the database. Keep Marasi open." },
  { id: "wait", label: "Wait", running: "Waiting" },
  { id: "load", label: "Load", running: "Loading" },
];
const stepIndex = Object.fromEntries(openSteps.map(({ id }, i) => [id, i]));
// The step index past the last step: the open succeeded.
const succeededStep = openSteps.length;

/**
 * The load sequence's signals (openProject in stores.js), one as each
 * thing it loads starts loading, in the order it loads them.
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
    // The last project.upgrading: {migration, applied, total}.
    upgrade: null,
    // What the switch waits for, from the last project.waiting.
    waitingFor: null,
    // The local instance that owns a locked project, once found.
    owner: null,
    part: 0,
    log: [],
    failure: null,
  };
}

// Whether the open is over, so its events no longer change it.
const isOver = (state) => state.step === succeededStep || Boolean(state.failure);

/** Feeds project.opening {project}: the path the open resolved to. */
export function withOpening(state, { project } = {}) {
  if (isOver(state)) return state;
  const path = state.path ?? (typeof project === "string" ? project : null);
  return { ...state, path, log: [...state.log, `Opening ${project}`] };
}

/** Feeds project.upgrading {migration, applied, total}: one more migration applied. */
export function withUpgrading(state, { migration, applied, total } = {}) {
  if (isOver(state)) return state;
  return {
    ...state,
    step: Math.max(state.step, stepIndex.upgrade),
    upgrade: { migration, applied, total },
    log: [...state.log, `Upgrade ${applied} of ${total}: ${migration}`],
  };
}

// One thing a switch waits for, as project.waiting names it.
function waitLabel(wait) {
  if (wait.kind === "checkpoint") return `Held ${wait.type}: ${wait.summary}`;
  if (wait.kind === "extension") return `Extension ${wait.name} running`;
  const count = wait.count ?? 1;
  return `${count} other call${count === 1 ? "" : "s"} finishing`;
}

/**
 * Feeds project.waiting {waiting_for}: the switch waits for held Checkpoint
 * items, running extension Lua or other work. Each event lists all of it.
 */
export function withWaiting(state, { waiting_for: waits = [] } = {}) {
  if (isOver(state)) return state;
  return {
    ...state,
    step: Math.max(state.step, stepIndex.wait),
    waitingFor: waits,
    log: [...state.log, `Waiting for: ${waits.map(waitLabel).join(", ")}`],
  };
}

/** Records the local instance `owner` that holds a locked project. */
export function withOwner(state, owner) {
  return { ...state, owner: owner ?? null };
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
 * Records that the app's Go side opened the target and released the
 * project open before: from here the open project is the target, even if
 * loading it fails.
 */
export function withSwitched(state) {
  return {
    ...state,
    step: Math.max(state.step, stepIndex.load),
    waitingFor: null,
    current: { name: state.name, path: state.path },
  };
}

/** Records that the open succeeded: the project is open and loaded. */
export function withOpened(state) {
  return { ...state, step: succeededStep };
}

// The text of a failure that carries only the HTTP status, as the POST's
// does when project.opening_failed has the real error.
const codeOnly = (text) => /: HTTP \d+$/.test(text);

/**
 * Records that the open failed with `error`: the POST's refusal or
 * project.opening_failed's text, in either order. A locked project
 * (`project_already_open`, "project already open: <path>") fails Open as
 * Locked; any other error fails the step that was running. Marasi's text
 * replaces a refusal that has only its code.
 */
export function withFailed(state, error) {
  const text = String(error ?? "");
  if (state.failure && !codeOnly(state.failure.error) && codeOnly(text)) return state;
  const lockedPath = /project already open: (.+)$/.exec(text)?.[1] ?? null;
  const locked =
    codeIDs(text, "project_already_open") !== null || lockedPath !== null || state.failure?.kind === "locked";
  const failedStep = state.failure ? state.step : Math.min(state.step, stepIndex.load);
  return {
    ...state,
    path: state.path ?? lockedPath,
    step: locked ? stepIndex.open : failedStep,
    failure: { kind: locked ? "locked" : "other", error: text },
    // Details ends with the error, as returned.
    log: [...state.log, text],
  };
}

/**
 * The instance's projects, as GET /project/list returns them
 * (`{name, project, modified_at}`), newest first, each `{name, path,
 * opened}` with how long before `now` (epoch ms) it was last opened.
 */
export function recentProjects(items, now = Date.now()) {
  const projects = (items ?? []).map(({ name, project, modified_at }) => ({
    name: name ?? projectName(project),
    path: project,
    at: Date.parse(modified_at),
    opened: openedAgo(modified_at, now),
  }));
  // A time that doesn't parse goes last.
  projects.sort((a, b) => (Number.isNaN(b.at) ? -Infinity : b.at) - (Number.isNaN(a.at) ? -Infinity : a.at));
  return projects.map(({ name, path, opened }) => ({ name, path, opened }));
}

/** Feeds the instance's projects to pick from after a failure, as recentProjects. */
export function withRecents(state, items, now = Date.now()) {
  return { ...state, recents: recentProjects(items, now) };
}

/** A project file's name, without its directory or ".marasi". */
export const projectName = (path) =>
  String(path)
    .split(/[\\/]/)
    .pop()
    .replace(/\.marasi$/, "");

// How long before `now` a project last opened, from RFC3339 `text`:
// "Just now", "20 minutes ago", "Yesterday", "Last week", up to four weeks,
// then the day it opened ("2026-08-02"). Empty when the time doesn't parse.
function openedAgo(text, now) {
  const at = Date.parse(text);
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
  // The day as Marasi wrote it.
  return String(text).slice(0, 10);
}

// Whether a recent project is `name` at `path`: by path when both are
// known, else by name (projects opened by bare name live in the config dir,
// as every recent project does).
const isProject = (recent, name, path) =>
  recent.path && path ? recent.path === path : recent.name === name;

/** Everything the opening screen renders. */
export function openingScreen(state) {
  const { failure } = state;
  const steps = openSteps.map(({ id, label, running }, i) => {
    let mark = "todo";
    if (i === state.step) mark = failure ? "failed" : "current";
    else if (i < state.step) mark = "done";
    if (mark === "current") return { id, label: running, mark };
    if (mark === "failed") return { id, label: failure.kind === "locked" ? "Locked" : label, mark };
    return { id, label, mark };
  });
  const loading = !failure && state.step === stepIndex.load;
  const part = loading ? loadParts[state.part].label : null;
  const waits = !failure && state.step === stepIndex.wait ? (state.waitingFor ?? []) : null;
  const held = waits?.filter((wait) => wait.kind === "checkpoint").length ?? 0;
  let sentence = "Opened.";
  if (failure?.kind === "locked") {
    const project = state.scratchpad ? "The scratchpad" : "The project";
    sentence = state.owner ? `${project} is open on ${state.owner}.` : `${project} is opened by another instance.`;
  }
  else if (failure) sentence = "Couldn't open the project.";
  else if (loading) sentence = `Loading ${part.toLowerCase()}.`;
  else if (waits && held) sentence = `Waiting for ${held} held Checkpoint item${held === 1 ? "" : "s"}.`;
  else if (waits) sentence = "Waiting for running work to finish.";
  else if (state.step < succeededStep) sentence = openSteps[state.step].sentence;
  return {
    project: { name: state.name, path: state.path },
    // The project that opened, once the open succeeded: what startup and
    // the window title take the project's name from.
    opened: state.step === succeededStep ? { name: state.name, path: state.path } : null,
    steps,
    sentence,
    upgrade: !failure && state.step === stepIndex.upgrade ? state.upgrade : null,
    waiting: waits && { items: waits.map(waitLabel), checkpoint: held > 0 },
    load: {
      part,
      done: state.step === succeededStep ? loadParts.length : loading ? state.part : 0,
      total: loadParts.length,
    },
    failure,
    // Stay in names the project still open, if any; only a locked project
    // may open on a retry, once the other instance lets it go, and only
    // its owner can be connected to.
    actions: failure
      ? {
          stayIn: state.current?.name ?? null,
          tryAgain: failure.kind === "locked",
          owner: failure.kind === "locked" ? state.owner : null,
        }
      : null,
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
