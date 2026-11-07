// Every event the Marasi service publishes on GET /events, from Marasi's
// `service` package (its `events.publish(...)` calls) and skills/marasi/SKILL.md.
// The app subscribes to each with `service.on(name, …)` somewhere under
// src/stores or src/lib, so a change another client makes (the CLI, a phone,
// another app) shows without a resync; events.test.js fails when one has no
// subscription. Add a name here when Marasi publishes a new event.
//
// launch.<status> is published for the terminal statuses only (completed,
// cancelled, failed); a pending launch is announced as launch.started.
export const SERVICE_EVENTS = [
  // Traffic and the sitemap
  "traffic.request",
  "traffic.response",
  "traffic.changed",
  "traffic.index_complete",
  "sitemap.changed",
  "metadata.updated",
  "note.updated",
  "note.deleted",
  // WebSockets
  "websocket.opened",
  "websocket.closed",
  "websocket.handshake_ended",
  "websocket.progress",
  "websocket.message",
  // Launchpads and launches
  "launchpad.created",
  "launchpad.updated",
  "launchpad.deleted",
  "launchpad.linked",
  "launchpad.unlinked",
  "launchpad.entries_moved",
  "launch.started",
  "launch.completed",
  "launch.cancelled",
  "launch.failed",
  // Checkpoint
  "checkpoint.held",
  "checkpoint.forwarded",
  "checkpoint.dropped",
  "checkpoint.updated",
  // Scope, extensions and their UI
  "scope.updated",
  "extension.enabled",
  "extension.updated",
  "extension.settings.updated",
  "extension.log",
  "extension.gui.rendered",
  "extension.gui.updated",
  // Upstream proxies and waypoints
  "upstream_proxy.added",
  "upstream_proxy.updated",
  "upstream_proxy.removed",
  "upstream_proxy.selected",
  "waypoint.added",
  "waypoint.updated",
  "waypoint.removed",
  // Armory and wordlists
  "armory.template.created",
  "armory.template.updated",
  "armory.template.deleted",
  "armory.run.created",
  "armory.run.updated",
  "armory.run.deleted",
  "wordlist.added",
  "wordlist.removed",
  // Logbook: findings, test cases, artifacts and report templates
  "finding.created",
  "finding.updated",
  "finding.deleted",
  "finding.linked",
  "finding.unlinked",
  "test-case.created",
  "test-case.updated",
  "test-case.deleted",
  "test-case.linked",
  "test-case.unlinked",
  "artifact.created",
  "artifact.deleted",
  "report.template.added",
  "report.template.removed",
  "report.template.restored",
  // Chrome paths and profiles (this machine's Marasi config)
  "chrome.profile.added",
  "chrome.profile.removed",
  "chrome.path.added",
  "chrome.path.removed",
  // Projects, jobs, the proxy listener and its log
  "project.opening",
  "project.upgrading",
  "project.waiting",
  "project.opened",
  "project.opening_failed",
  "job.progress",
  "job.complete",
  "listener.started",
  "listener.updated",
  "listener.stopped",
  "log.added",
  // The service itself: its control address, restarts and updates
  "control_listener.started",
  "control_listener.updated",
  "control_listener.stopped",
  "service.restarting",
  "service.restart_failed",
  "update.available",
  "update.progress",
  "update.installed",
  "update.failed",
];

// The stream's own events, which the client handles itself rather than
// through on(): `stream.reset` reaches openEvents' onReset, and the stream
// closes after `stream.dropped`, which is a drop like any other.
export const STREAM_EVENTS = ["stream.reset", "stream.dropped"];
