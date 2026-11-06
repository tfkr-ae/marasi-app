// The connection store: the app's way to the Marasi service it works
// against. Its lifecycle is the pure `reduce(state, action)`, which returns
// the next state and the steps for the store to perform; the store performs
// them through the injected `api`, and each step's outcome comes back as the
// next action. Tests run the reducer alone, and the store with a fake api:
//
//   connectLocal() -> {url, password, startedByApp}  start or attach (Go)
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
    // Only the local connection exists so far.
    connection: { id: "local", kind: "local", name: "Local" },
    // The app started the local instance, so it stops it on quit (Go).
    owned: false,
    url: null,
    project: null,
    version: null,
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

/** The wait before reconnect attempt `attempt` (1, 2, …): 1s doubling to 30s. */
export function backoff(attempt) {
  return Math.min(2 ** (attempt - 1), 30) * 1000;
}

const go = (state, patch, steps = []) => ({ state: { ...state, ...patch }, steps, refusal: null });
const refuse = (state, refusal) => ({ state, steps: [], refusal });

// Reaches the active connection from scratch.
function begin(state) {
  return go(state, { phase: "starting", error: null, url: null, project: null, version: null, proxyListener: null }, [
    { type: "connect-local" },
  ]);
}

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
      const { status } = action;
      return go(
        state,
        {
          phase: "connected",
          project: status.project,
          version: status.version,
          proxyListener: status.proxy_listener ?? null,
          error: null,
        },
        [{ type: "open-events" }, { type: "load-project", status }],
      );
    }

    case "CONNECT_FAILED":
      if (state.phase !== "connecting") return refuse(state, "Nothing is connecting.");
      return go(state, { phase: "failed", error: action.error });

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

    case "RETRY":
      if (state.phase !== "failed") return refuse(state, "Nothing to retry.");
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
      case "use":
        api.use({ url: step.url, password: step.password });
        return;
      case "read-status": {
        let status;
        try {
          status = await api.readStatus();
        } catch (err) {
          dispatch({ type: "CONNECT_FAILED", error: message(err) });
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
        // restarted on a new port), so reach it as on starting.
        let local, status;
        try {
          local = await api.connectLocal();
          api.use({ url: local.url, password: local.password });
          status = await api.readStatus();
        } catch (err) {
          console.error("Reconnecting to Marasi failed:", err);
          dispatch({ type: "STREAM_DROPPED" });
          return;
        }
        dispatch({ type: "RECONNECTED", url: local.url, startedByApp: local.startedByApp, status });
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

  return {
    subscribe: store.subscribe,
    /** Starts reaching the service, once, when the app opens. */
    start: () => dispatch({ type: "APP_STARTED" }),
    /** Begins again after a failure. */
    retry: () => dispatch({ type: "RETRY" }),
    /** Reconnects now instead of waiting (the banner's Retry now). */
    retryNow: () => dispatch({ type: "RECONNECT_NOW" }),
    /** Loads the project a reconnect found, asking about unsaved work again. */
    loadPending: () => dispatch({ type: "LOAD_PROJECT" }),
    dispatch,
  };
}
