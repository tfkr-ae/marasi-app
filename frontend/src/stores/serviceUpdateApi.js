// The service update API adapter over the service client: the control API
// routes for inspecting, checking, installing, cancelling, changing channel,
// and reinstalling a connected service's own update (service/update_routes.go).
// Maps snake_case API payloads and live SSE events to the camelCase shapes
// `serviceUpdate.js` reads, so only this adapter knows the wire field names.
// Each call accepts a bound link from `bind()` so connection switches supersede
// in-flight calls cleanly.

/** Normalizes an available-update payload (`GET /update`, `update.available`). */
export function toAvailable(raw) {
  if (!raw || !raw.version) return null;
  return {
    version: raw.version,
    channel: raw.channel ?? "",
    published: raw.published ?? null,
    notes: raw.notes ?? "",
    page: raw.page ?? "",
  };
}

function toLastCheck(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    at: raw.at ?? null,
    latest: raw.latest ?? null,
    error: raw.error ?? "",
  };
}

function toInstallState(raw) {
  if (!raw || typeof raw !== "object") return null;
  const err = raw.error && typeof raw.error === "object"
    ? {
        kind: raw.error.kind ?? "",
        step: raw.error.step ?? "",
        message: raw.error.message ?? "",
        page: raw.error.page ?? "",
      }
    : null;
  return {
    state: raw.state ?? "idle",
    version: raw.version ?? "",
    step: raw.step ?? "",
    received: raw.received ?? 0,
    total: raw.total ?? 0,
    error: err,
  };
}

/** Normalizes a snapshot from `GET /update`, `POST /update/check`, or `PUT /update/channel`. */
export function toUpdateSnapshot(raw) {
  if (!raw || typeof raw !== "object") return null;
  const installed = raw.installed
    ? { version: raw.installed.version ?? "", channel: raw.installed.channel ?? null }
    : null;
  return {
    installed,
    development: Boolean(raw.development),
    channel: raw.channel ?? installed?.channel ?? null,
    autoCheck: Boolean(raw.auto_check ?? raw.autoCheck),
    lastCheck: toLastCheck(raw.last_check ?? raw.lastCheck),
    available: toAvailable(raw.available),
    install: toInstallState(raw.install),
    restartRequired: Boolean(raw.restart_required ?? raw.restartRequired),
    installPath: raw.install_path ?? raw.installPath ?? "",
  };
}

/** Normalizes the 202 response from `POST /update/install` or `POST /update/reinstall`. */
export function toInstallStart(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    joined: Boolean(raw.joined),
    install: toInstallState(raw.install),
    installPath: raw.install_path ?? raw.installPath ?? "",
  };
}

/** Normalizes a live `update.*` SSE event payload at the event boundary. */
export function toUpdateEvent(name, raw) {
  const e = raw && typeof raw === "object" ? raw : {};
  if (name === "update.available") return toAvailable(e);
  if (name === "update.progress") {
    return {
      version: e.version,
      step: e.step,
      received: e.received,
      total: e.total,
    };
  }
  if (name === "update.installed") {
    return {
      version: e.version,
      installPath: e.install_path ?? e.installPath,
    };
  }
  if (name === "update.failed") {
    return {
      version: e.version,
      kind: e.kind,
      step: e.step,
      message: e.message,
      page: e.page,
      installPath: e.install_path ?? e.installPath,
    };
  }
  return e;
}

/** Attaches camelCase error body details onto a rejected ServiceError. */
export function normalizeUpdateError(err) {
  if (err && typeof err === "object" && err.body && typeof err.body === "object") {
    err.details = {
      message: typeof err.body.message === "string" ? err.body.message.trim() : "",
      page: err.body.page ?? "",
      installPath: err.body.install_path ?? err.body.installPath ?? "",
      instance: err.body.instance ?? "",
    };
  }
  throw err;
}

export function createServiceUpdateApi(client) {
  return {
    bind: () => client.bind(),
    getUpdate: (link = client) => link.get("/update").then(toUpdateSnapshot, normalizeUpdateError),
    checkUpdate: (link = client) => link.post("/update/check").then(toUpdateSnapshot, normalizeUpdateError),
    installUpdate: (link = client) => link.post("/update/install").then(toInstallStart, normalizeUpdateError),
    cancelInstall: (link = client) => link.del("/update/install").catch(normalizeUpdateError),
    setChannel: (channel, link = client) =>
      link.put("/update/channel", { channel }).then(toUpdateSnapshot, normalizeUpdateError),
    reinstallUpdate: (link = client) =>
      link.post("/update/reinstall", { confirm: true }).then(toInstallStart, normalizeUpdateError),
  };
}
