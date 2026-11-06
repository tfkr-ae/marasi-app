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
  };
  const { connection } = state;
  if (connection.kind === "local") {
    return go(state, { phase: "starting", error: null, ...reset }, [{ type: "connect-local" }]);
  }
  return go(state, { phase: "connecting", error: null, ...reset }, [
    { type: "connect-remote", id: connection.id, url: connection.url },
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

    case "STREAM_DROPPED": {
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
    dispatch,
  };
}
