// The connection store: the app's way to the Marasi service it works
// against. Its lifecycle is the pure `reduce(state, action)`, which returns
// the next state and the steps for the store to perform; the store performs
// them through the injected `api`, and each step's outcome comes back as the
// next action. Tests run the reducer alone, and the store with a fake api:
//
//   listConnections() -> {connections, activeId}     the saved connections (Go)
//   connectLocal() -> {url, password, startedByApp}  start or attach (Go)
//   connectionPassword(id) -> password               a remote's saved password (Go)
//   savePassword(id, password)                       replace it (Go)
//   setActive(id)                                    save the active connection (Go)
//   clearStores()                                    forget the last service's data
//   confirmSwitch() -> bool                          the unsaved-work prompt (Go)
//   use({url, password})                             point the service client
//   readStatus() -> GET /service/status
//   openEvents({onDrop})                              open GET /events
//   closeEvents()
//   loadProject(status)                               load the service's project
//   readControl() -> GET /service/control-listener/status
//   updateControl(body) -> POST /service/control-listener/update
//   forgetPassword(id, origins)                       a remote's password is off (Go)
//   appOrigin() -> the app's own Origin
//
// Sharing and password changes (SHARE_LOCAL, STOP_SHARING, ROTATE_PASSWORD,
// SET_NO_PASSWORD) set `busy`, close /events, change the control listener,
// save a remote's new password (instance first, then the keychain), then
// `rejoin` quietly and resync; a drop while busy is expected, not a reconnect.
//
// Phases so far: idle → starting (the local instance) → connecting (its
// status) → connected, or failed with `error` (Retry begins again). To add an
// event (reconnecting, a refused password, switching connections): add its
// phase or action to `reduce`, its step to `perform`, and a scenario test.
// The password passes through steps and never lands in the state.
import { get, writable } from "svelte/store";

/** The state before the app starts reaching a service. */
export function initialConnection() {
  return {
    phase: "idle",
    // The saved connections (Go's ListConnections), local first, and the
    // active one.
    connections: [localConnection],
    connection: localConnection,
    // A switch is under way: the next connect remounts the pages.
    switching: false,
    // Where a refused password came from, to resume it once entered.
    authFrom: null,
    // The app started the local instance, so it stops it on quit (Go).
    owned: false,
    url: null,
    project: null,
    // The instance the service runs as ("default" for the local one).
    instance: null,
    // The service's version, and the warning when it is older than the
    // Marasi the app pins (`pin`, its date, from MARASI_PIN).
    version: null,
    pin: null,
    versionWarning: null,
    proxyListener: null,
    error: null,
    // Reconnect attempts since the stream dropped, and whether one is
    // reaching the service now.
    attempt: 0,
    trying: false,
    // The service said it is restarting before the stream dropped.
    restartSeen: false,
    // The project a reconnect found open instead, waiting for the
    // unsaved-work guard before it loads.
    pendingProject: null,
    // The control listener as the service reports it: {address,
    // passwordSet, allowedOrigins}, or null before it is read.
    control: null,
    // A change under way ("share", "rotate" or "password-off"); /events is
    // closed until it rejoins, and why the last one failed.
    busy: null,
    changeError: null,
    // The host the pairing code names instead of the listener's own.
    shareHost: "",
    // The app's own origin, which turning the password off always allows.
    appOrigin: null,
  };
}

const localConnection = { id: "local", kind: "local", name: "Local", url: "" };

/** Whether `err` is the service refusing the password (401 unauthorized). */
export const isAuthRefusal = (err) => err?.code === "unauthorized" || err?.status === 401;

/** The wait before reconnect attempt `attempt` (1, 2, …): 1s doubling to 30s. */
export function backoff(attempt) {
  return Math.min(2 ** (attempt - 1), 30) * 1000;
}

// A version's date as YYYYMMDD, for comparing: "29.10.2026",
// "29.10.2026-rc1" and "29.10.2026 (nightly abc1234)" all date 20261029.
function versionDate(version) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(version ?? "");
  return m ? `${m[3]}${m[2]}${m[1]}` : null;
}

/**
 * The warning for a service `version` older than the app's `pin` date, or
 * null. A dev service, or a version or pin without a date, never warns.
 */
export function versionWarning(version, pin) {
  const service = versionDate(version);
  const needed = versionDate(pin);
  if (!service || !needed || service >= needed) return null;
  return `Service is ${version}, the app needs ${pin} or later`;
}

/** Whether `text` is an IPv4 or IPv6 address (no port, no brackets). */
export function isIP(text) {
  const value = String(text ?? "");
  if (/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(value)) {
    return value.split(".").every((part) => Number(part) <= 255);
  }
  if (!value.includes(":") || !/^[0-9a-fA-F:.%a-zA-Z0-9]+$/.test(value)) return false;
  try {
    return new URL(`http://[${value}]/`).hostname !== "";
  } catch {
    return false;
  }
}

/**
 * Whether `text` is an origin a browser sends: null, or SCHEME://HOST[:PORT]
 * with no path, query, credentials or wildcard (as Marasi checks it).
 */
export function isOrigin(text) {
  return text === "null" || /^[a-z][a-z0-9+.-]*:\/\/(\[[0-9a-f:.]+\]|[^/?#@*\s:[\]]+)(:\d{1,5})?$/i.test(text);
}

// Without a password the service accepts only an IP (or localhost) as the
// Host, so a remote reached by hostname would lock the app out.
function reachableWithoutPassword(url) {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
    return isIP(host) || host === "localhost";
  } catch {
    return false;
  }
}

const go = (state, patch, steps = []) => ({ state: { ...state, ...patch }, steps, refusal: null });
const refuse = (state, refusal) => ({ state, steps: [], refusal });

// Reaches the active connection from scratch: the local instance through
// the CLI, a remote with its saved password.
function begin(state) {
  const reset = {
    url: null,
    project: null,
    version: null,
    versionWarning: null,
    proxyListener: null,
    instance: null,
    attempt: 0,
    trying: false,
    restartSeen: false,
    pendingProject: null,
    authFrom: null,
    control: null,
    busy: null,
    changeError: null,
    shareHost: "",
  };
  const { connection } = state;
  if (connection.kind === "local") {
    return go(state, { phase: "starting", error: null, ...reset }, [{ type: "connect-local" }]);
  }
  return go(state, { phase: "connecting", error: null, ...reset }, [
    { type: "connect-remote", id: connection.id, url: connection.url },
  ]);
}

// The control listener status the service answers, in the store's shape.
export function controlFrom(status) {
  return {
    address: status?.control_listener ?? null,
    passwordSet: Boolean(status?.password_set),
    allowedOrigins: status?.allowed_origins ?? [],
  };
}

const passwordOff = (state) => state.control !== null && !state.control.passwordSet;

// A change of the control listener (share, password): only on a connected
// service, one at a time. The stream closes until it rejoins.
function change(state, busy, body, patch = {}) {
  if (state.phase !== "connected") return refuse(state, "Connect first.");
  if (state.busy) return refuse(state, "Another change is under way.");
  return go(state, { ...patch, busy, changeError: null }, [
    { type: "close-events" },
    { type: "update-control", body },
  ]);
}

// An outcome for a connection the app has since switched away from.
const stale = (state, action) => action.id !== undefined && action.id !== state.connection.id;

/** The next state for `action`, the steps to perform, and any refusal. */
export function reduce(state, action) {
  switch (action.type) {
    case "APP_STARTED":
      if (state.phase !== "idle") return refuse(state, "The connection has already started.");
      return begin(state);

    case "INSTANCE_UP":
      if (state.phase !== "starting") return refuse(state, "The app isn't starting the local instance.");
      return go(state, { phase: "connecting", owned: state.owned || action.startedByApp, url: action.url }, [
        { type: "use", url: action.url, password: action.password },
        { type: "read-status" },
      ]);

    case "INSTANCE_FAILED":
      if (state.phase !== "starting") return refuse(state, "The app isn't starting the local instance.");
      return go(state, { phase: "failed", error: action.error });

    case "CONNECTED": {
      if (state.phase !== "connecting") return refuse(state, "Nothing is connecting.");
      if (stale(state, action)) return refuse(state, "That connection isn't active any more.");
      const { status } = action;
      return go(
        state,
        {
          phase: "connected",
          url: action.url ?? state.url,
          switching: false,
          project: status.project,
          version: status.version,
          versionWarning: versionWarning(status.version, state.pin),
          instance: status.instance ?? null,
          proxyListener: status.proxy_listener ?? null,
          error: null,
        },
        // After a switch the pages remount on the other service's project.
        [{ type: "open-events" }, { type: state.switching ? "reload-project" : "load-project", status }],
      );
    }

    case "CONNECT_FAILED":
      if (state.phase !== "connecting") return refuse(state, "Nothing is connecting.");
      if (stale(state, action)) return refuse(state, "That connection isn't active any more.");
      return go(state, { phase: "failed", error: action.error });

    case "AUTH_REJECTED":
      // The service refused the password: ask for it, never retry on a timer.
      if (state.phase !== "connecting" && state.phase !== "reconnecting") return refuse(state, "Nothing is connecting.");
      if (stale(state, action)) return refuse(state, "That connection isn't active any more.");
      return go(
        state,
        {
          phase: "auth-failed",
          authFrom: state.phase,
          attempt: 0,
          trying: false,
          error: `${state.connection.name} refused the password`,
        },
        state.phase === "reconnecting" ? [{ type: "cancel-wait" }] : [],
      );

    case "ENTER_PASSWORD":
      if (state.phase !== "auth-failed") return refuse(state, "No password is being asked for.");
      if (!action.password) return refuse(state, "Enter the password.");
      return go(state, { error: null }, [{ type: "save-password", id: state.connection.id, password: action.password }]);

    case "PASSWORD_SAVED":
      if (state.phase !== "auth-failed") return refuse(state, "No password is being asked for.");
      if (stale(state, action)) return refuse(state, "That connection isn't active any more.");
      // A refused reconnect resumes in place; a refused connect begins again.
      if (state.authFrom === "reconnecting") {
        return go(state, { phase: "reconnecting", authFrom: null, trying: true, attempt: 1 }, [{ type: "reconnect" }]);
      }
      return begin(state);

    case "PASSWORD_SAVE_FAILED":
      if (state.phase !== "auth-failed") return refuse(state, "No password is being asked for.");
      return go(state, { error: action.error });

    case "CONNECTIONS_LOADED": {
      // The saved connections, on start and after one is added, edited or
      // removed. An edited address of the active remote reaches it again.
      const connections = action.connections?.length ? action.connections : [localConnection];
      const wanted = state.phase === "idle" ? action.activeId : state.connection.id;
      const connection = connections.find((c) => c.id === wanted) ?? connections[0];
      const next = { ...state, connections, connection };
      const moved = state.phase !== "idle" && connection.kind === "remote" && connection.url !== state.connection.url;
      if (!moved) return go(next, {});
      const restart = begin(next);
      return { ...restart, steps: [{ type: "close-events" }, { type: "cancel-wait" }, ...restart.steps] };
    }

    case "SWITCH_CONNECTION": {
      if (action.id === state.connection.id) return refuse(state, "Already on that connection.");
      if (!state.connections.some((c) => c.id === action.id)) return refuse(state, "No such connection.");
      return go(state, {}, [{ type: "confirm-leave", id: action.id }]);
    }

    case "SWITCH_CONFIRMED": {
      const connection = state.connections.find((c) => c.id === action.id);
      if (!connection || connection.id === state.connection.id) return refuse(state, "No such connection.");
      // The local instance keeps running until quit, so `owned` stays.
      const next = begin({ ...state, connection, switching: true });
      return {
        ...next,
        steps: [
          { type: "close-events" },
          { type: "cancel-wait" },
          { type: "set-active", id: connection.id },
          { type: "clear-stores" },
          ...next.steps,
        ],
      };
    }

    case "APP_ORIGIN":
      return go(state, { appOrigin: action.origin || null });

    case "READ_CONTROL":
      if (state.phase !== "connected") return refuse(state, "Connect first.");
      return go(state, {}, [{ type: "read-control" }]);

    case "CONTROL_LOADED":
      return go(state, { control: controlFrom(action.control) });

    case "SHARE_LOCAL": {
      if (state.connection.kind !== "local") return refuse(state, "Only the local instance can be shared.");
      if (state.phase !== "connected") return refuse(state, "Connect first.");
      if (!isIP(action.address)) return refuse(state, "Pick an interface.");
      const port = Number(action.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535) return refuse(state, "Enter a port from 0 to 65535.");
      const host = String(action.host ?? "").trim();
      if (host && !isIP(host) && passwordOff(state)) return refuse(state, "Without a password, share by IP.");
      // Beyond loopback with no password, the service wants the consent.
      const body = { address: action.address, port, ...(passwordOff(state) ? { no_password: true } : {}) };
      return change(state, "share", body, { shareHost: host });
    }

    case "STOP_SHARING":
      if (state.connection.kind !== "local") return refuse(state, "Only the local instance can be shared.");
      return change(state, "share", { address: "127.0.0.1", port: 0 }, { shareHost: "" });

    case "SET_SHARE_HOST": {
      const host = String(action.host ?? "").trim();
      if (host && !isIP(host) && passwordOff(state)) return refuse(state, "Without a password, share by IP.");
      return go(state, { shareHost: host });
    }

    case "ROTATE_PASSWORD":
      if (!action.password) return refuse(state, "Enter a password.");
      return change(state, "rotate", { password: action.password });

    case "SET_NO_PASSWORD": {
      const origins = (action.origins ?? []).map((o) => String(o).trim().toLowerCase()).filter(Boolean);
      if (!origins.length) return refuse(state, "Add at least one origin.");
      const bad = origins.find((o) => !isOrigin(o));
      if (bad) return refuse(state, `${bad} isn't an origin such as http://localhost:5173.`);
      // The service accepts only an IP host without a password, so a code
      // or an address naming a hostname could never connect.
      if (state.connection.kind === "local" && state.shareHost && !isIP(state.shareHost)) {
        return refuse(state, "Share by IP before turning the password off.");
      }
      if (state.connection.kind === "remote" && !reachableWithoutPassword(state.connection.url)) {
        return refuse(state, "Reach it by IP before turning the password off.");
      }
      const allowed = [...new Set([...origins, ...(state.appOrigin ? [state.appOrigin.toLowerCase()] : [])])];
      return change(state, "password-off", { no_password: true, allowed_origins: allowed });
    }

    case "CONTROL_UPDATED": {
      if (!state.busy) return refuse(state, "No change is under way.");
      const next = { ...state, control: controlFrom(action.control) };
      const remote = state.connection.kind === "remote";
      if (state.busy === "rotate" && remote) {
        return go(next, {}, [{ type: "store-password", id: state.connection.id, password: action.password }]);
      }
      if (state.busy === "password-off" && remote) {
        // The saved connection keeps the origins the service now allows.
        return go(next, {}, [{ type: "forget-password", id: state.connection.id, origins: next.control.allowedOrigins }]);
      }
      // The local instance's address and password are read back from it.
      return go(next, {}, [{ type: "rejoin" }]);
    }

    case "CONTROL_FAILED":
      if (!state.busy) return refuse(state, "No change is under way.");
      return go(state, { busy: null, changeError: action.error }, [{ type: "open-events" }, { type: "resync" }]);

    case "KEYCHAIN_DONE":
      if (!state.busy) return refuse(state, "No change is under way.");
      return go(state, { changeError: action.error ? `Saving the password failed: ${action.error}` : null }, [
        { type: "rejoin", password: action.password ?? "" },
      ]);

    case "REJOINED":
      if (!state.busy) return refuse(state, "No change is under way.");
      return go(
        state,
        {
          busy: null,
          url: action.url ?? state.url,
          control: action.control ? controlFrom(action.control) : state.control,
          owned: state.owned || Boolean(action.startedByApp),
        },
        [{ type: "open-events" }, { type: "resync" }],
      );

    case "REJOIN_FAILED":
      // The change landed but the app couldn't reach the service after it:
      // reconnect as after any drop, or ask for a refused password.
      if (!state.busy) return refuse(state, "No change is under way.");
      if (action.auth) {
        return go(state, {
          busy: null,
          phase: "auth-failed",
          authFrom: "reconnecting",
          error: `${state.connection.name} refused the password`,
        });
      }
      return go(state, { busy: null, phase: "reconnecting", attempt: 1, trying: false, changeError: action.error ?? null }, [
        { type: "wait", ms: backoff(1) },
      ]);

    case "STREAM_DROPPED": {
      // A change closed the stream on purpose and rejoins by itself.
      if (state.busy) return go(state, {});
      // A drop of the stream (whatever the reason: a network failure, a
      // restart, the service dropping a subscriber whose queue overflowed),
      // or a failed reconnect attempt. The pages stay; only the stream goes.
      if (state.phase !== "connected" && state.phase !== "reconnecting") return refuse(state, "Not connected.");
      const attempt = state.attempt + 1;
      return go(state, { phase: "reconnecting", attempt, trying: false }, [
        ...(state.phase === "connected" ? [{ type: "close-events" }] : []),
        { type: "wait", ms: backoff(attempt) },
      ]);
    }

    case "RECONNECT_NOW":
      // The wait ended, or Retry now.
      if (state.phase !== "reconnecting") return refuse(state, "Not reconnecting.");
      if (state.trying) return refuse(state, "Already reconnecting.");
      return go(state, { trying: true }, [{ type: "cancel-wait" }, { type: "reconnect" }]);

    case "SERVICE_RESTARTING":
      return go(state, { restartSeen: true });

    case "RECONNECTED": {
      if (state.phase !== "reconnecting") return refuse(state, "Not reconnecting.");
      const { status } = action;
      // /service/status has no boot id: a restart is a service.restarting
      // seen before the drop, or a new version (decisions.md, ruling 2).
      const restarted = state.restartSeen || status.version !== state.version;
      const patch = {
        attempt: 0,
        trying: false,
        restartSeen: false,
        url: action.url ?? state.url,
        owned: state.owned || Boolean(action.startedByApp),
        version: status.version,
        versionWarning: versionWarning(status.version, state.pin),
        proxyListener: status.proxy_listener ?? null,
      };
      if (status.project === state.project && !restarted) {
        return go(state, { ...patch, phase: "connected" }, [{ type: "open-events" }, { type: "resync" }]);
      }
      return go(state, { ...patch, phase: "project-changed", pendingProject: status.project }, [
        { type: "confirm-load", status },
      ]);
    }

    case "LOAD_PROJECT":
      // Load the project a reconnect found, after declining it once.
      if (state.phase !== "project-changed") return refuse(state, "No project waits to load.");
      return go(state, {}, [{ type: "confirm-load", status: { project: state.pendingProject } }]);

    case "LOAD_CONFIRMED": {
      if (state.phase !== "project-changed") return refuse(state, "No project waits to load.");
      const status = { project: state.pendingProject, version: state.version, proxy_listener: state.proxyListener };
      return go(state, { phase: "connected", project: state.pendingProject, pendingProject: null }, [
        { type: "open-events" },
        { type: "reload-project", status },
      ]);
    }

    case "LOAD_DECLINED":
      if (state.phase !== "project-changed") return refuse(state, "No project waits to load.");
      return go(state, {});

    case "PROJECT_LOADED":
      // A switch loaded another project: reconnects compare against it.
      return go(state, { project: action.path });

    case "MARASI_PIN":
      // The app's pinned Marasi date (Go's MarasiPin), read once at start.
      return go(state, { pin: action.pin || null, versionWarning: versionWarning(state.version, action.pin) });

    case "RETRY":
      if (state.phase !== "failed" && state.phase !== "auth-failed") return refuse(state, "Nothing to retry.");
      return begin(state);

    default:
      return refuse(state, `Unknown action ${action.type}`);
  }
}

const message = (err) => String(err?.message ?? err);

export function createConnectionStore(api, timers = globalThis) {
  const store = writable(initialConnection());
  // The pending wait before the next reconnect attempt.
  let waiting = null;

  function dispatch(action) {
    const next = reduce(get(store), action);
    if (next.refusal) return next.refusal;
    store.set(next.state);
    for (const step of next.steps) perform(step);
    return null;
  }

  async function perform(step) {
    switch (step.type) {
      case "connect-local": {
        let local;
        try {
          local = await api.connectLocal();
        } catch (err) {
          dispatch({ type: "INSTANCE_FAILED", error: message(err) });
          return;
        }
        dispatch({ type: "INSTANCE_UP", url: local.url, password: local.password, startedByApp: local.startedByApp });
        return;
      }
      case "connect-remote": {
        let status;
        try {
          const password = await api.connectionPassword(step.id);
          api.use({ url: step.url, password });
          status = await api.readStatus();
        } catch (err) {
          dispatch(
            isAuthRefusal(err)
              ? { type: "AUTH_REJECTED", id: step.id }
              : { type: "CONNECT_FAILED", id: step.id, error: message(err) },
          );
          return;
        }
        dispatch({ type: "CONNECTED", id: step.id, url: step.url, status });
        return;
      }
      case "save-password":
        try {
          await api.savePassword(step.id, step.password);
        } catch (err) {
          dispatch({ type: "PASSWORD_SAVE_FAILED", error: message(err) });
          return;
        }
        dispatch({ type: "PASSWORD_SAVED", id: step.id });
        return;
      case "confirm-leave": {
        let agreed = false;
        try {
          agreed = await api.confirmSwitch();
        } catch (err) {
          console.error("Asking about unsaved work failed:", err);
        }
        if (agreed) dispatch({ type: "SWITCH_CONFIRMED", id: step.id });
        return;
      }
      case "set-active":
        try {
          await api.setActive(step.id);
        } catch (err) {
          console.error("Saving the active connection failed:", err);
        }
        return;
      case "clear-stores":
        try {
          await api.clearStores();
        } catch (err) {
          console.error("Clearing the stores failed:", err);
        }
        return;
      case "use":
        api.use({ url: step.url, password: step.password });
        return;
      case "read-status": {
        let status;
        try {
          status = await api.readStatus();
        } catch (err) {
          dispatch(isAuthRefusal(err) ? { type: "AUTH_REJECTED" } : { type: "CONNECT_FAILED", error: message(err) });
          return;
        }
        dispatch({ type: "CONNECTED", status });
        return;
      }
      case "open-events":
        api.openEvents({ onDrop: (drop) => dispatch({ type: "STREAM_DROPPED", status: drop?.status ?? null }) });
        return;
      case "wait":
        timers.clearTimeout(waiting);
        waiting = timers.setTimeout(() => {
          waiting = null;
          dispatch({ type: "RECONNECT_NOW" });
        }, step.ms);
        return;
      case "cancel-wait":
        if (waiting !== null) timers.clearTimeout(waiting);
        waiting = null;
        return;
      case "reconnect": {
        // The local instance's address can change (its control listener
        // restarted on a new port), so reach it as on starting. A remote is
        // reached with its saved password, which may have changed.
        const { connection } = get(store);
        let reached, status;
        try {
          if (connection.kind === "local") {
            reached = await api.connectLocal();
          } else {
            reached = { url: connection.url, password: await api.connectionPassword(connection.id), startedByApp: false };
          }
          api.use({ url: reached.url, password: reached.password });
          status = await api.readStatus();
        } catch (err) {
          if (isAuthRefusal(err)) {
            dispatch({ type: "AUTH_REJECTED", id: connection.id });
            return;
          }
          console.error("Reconnecting to Marasi failed:", err);
          dispatch({ type: "STREAM_DROPPED" });
          return;
        }
        dispatch({ type: "RECONNECTED", url: reached.url, startedByApp: reached.startedByApp, status });
        return;
      }
      case "resync":
        try {
          await api.resync();
        } catch (err) {
          console.error("Resyncing the stores failed:", err);
        }
        return;
      case "confirm-load": {
        let agreed = false;
        try {
          agreed = await api.confirmSwitch();
        } catch (err) {
          console.error("Asking about unsaved work failed:", err);
        }
        dispatch({ type: agreed ? "LOAD_CONFIRMED" : "LOAD_DECLINED" });
        return;
      }
      case "reload-project":
        try {
          await api.reloadProject(step.status);
        } catch (err) {
          console.error("Loading the service's project failed:", err);
        }
        return;
      case "close-events":
        api.closeEvents();
        return;
      case "read-control":
        try {
          dispatch({ type: "CONTROL_LOADED", control: await api.readControl() });
        } catch (err) {
          console.error("Reading the control listener failed:", err);
        }
        return;
      case "update-control": {
        let control;
        try {
          control = await api.updateControl(step.body);
        } catch (err) {
          dispatch({ type: "CONTROL_FAILED", error: message(err) });
          return;
        }
        dispatch({ type: "CONTROL_UPDATED", control, password: step.body.password });
        return;
      }
      case "store-password":
        try {
          await api.savePassword(step.id, step.password);
        } catch (err) {
          dispatch({ type: "KEYCHAIN_DONE", password: step.password, error: message(err) });
          return;
        }
        dispatch({ type: "KEYCHAIN_DONE", password: step.password });
        return;
      case "forget-password":
        try {
          await api.forgetPassword(step.id, step.origins);
        } catch (err) {
          dispatch({ type: "KEYCHAIN_DONE", password: "", error: message(err) });
          return;
        }
        dispatch({ type: "KEYCHAIN_DONE", password: "" });
        return;
      case "rejoin": {
        // After a change the app reaches the service again on purpose: the
        // local instance through Go (its address or password moved), a
        // remote with the password the change set.
        const { connection } = get(store);
        let reached, status, control;
        try {
          reached =
            connection.kind === "local"
              ? await api.connectLocal()
              : { url: connection.url, password: step.password ?? "", startedByApp: false };
          api.use({ url: reached.url, password: reached.password });
          status = await api.readStatus();
          control = await api.readControl().catch(() => null);
        } catch (err) {
          dispatch({ type: "REJOIN_FAILED", auth: isAuthRefusal(err), error: message(err) });
          return;
        }
        dispatch({ type: "REJOINED", url: reached.url, startedByApp: reached.startedByApp, status, control });
        return;
      }
      case "load-project":
        try {
          await api.loadProject(step.status);
        } catch (err) {
          console.error("Loading the service's project failed:", err);
        }
        return;
    }
  }

  /** Reads the saved connections (on start, and after a change). */
  async function load() {
    const saved = await api.listConnections();
    dispatch({ type: "CONNECTIONS_LOADED", connections: saved.connections, activeId: saved.activeId });
  }

  return {
    subscribe: store.subscribe,
    load,
    /** Switches to connection `id`, asking about unsaved work first. */
    switchTo: (id) => dispatch({ type: "SWITCH_CONNECTION", id }),
    /** Saves the password a refusal asked for, then connects again. */
    enterPassword: (password) => dispatch({ type: "ENTER_PASSWORD", password }),
    /**
     * Reads the saved connections, then starts reaching the active one,
     * once, when the app opens. Without them it reaches the local one.
     */
    async start() {
      if (api.appOrigin) dispatch({ type: "APP_ORIGIN", origin: api.appOrigin() });
      if (api.listConnections) {
        await load().catch((err) => console.error("Reading the saved connections failed:", err));
      }
      return dispatch({ type: "APP_STARTED" });
    },
    /** Begins again after a failure. */
    retry: () => dispatch({ type: "RETRY" }),
    /** Reconnects now instead of waiting (the banner's Retry now). */
    retryNow: () => dispatch({ type: "RECONNECT_NOW" }),
    /** Loads the project a reconnect found, asking about unsaved work again. */
    loadPending: () => dispatch({ type: "LOAD_PROJECT" }),
    /** Reads the control listener (sharing, password, origins). */
    readControl: () => dispatch({ type: "READ_CONTROL" }),
    /** Shares the local instance on `address:port`; `host` names it in the code. */
    share: (address, port, host = "") => dispatch({ type: "SHARE_LOCAL", address, port, host }),
    /** Rebinds the local instance's control listener to loopback. */
    stopSharing: () => dispatch({ type: "STOP_SHARING" }),
    /** The host the pairing code names instead of the listener's own. */
    setShareHost: (host) => dispatch({ type: "SET_SHARE_HOST", host }),
    /** Sets a new password (generated when none is given) and stays connected. */
    changePassword: (password = newPassword()) => dispatch({ type: "ROTATE_PASSWORD", password }),
    /** Removes the password, allowing `origins` plus the app's own. */
    turnOffPassword: (origins) => dispatch({ type: "SET_NO_PASSWORD", origins }),
    dispatch,
  };
}

/** A random control password, URL-safe base64 as the Go side makes them. */
export function newPassword() {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
