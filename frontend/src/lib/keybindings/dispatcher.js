import { eligibleContextIds } from "./contexts.js";
import { shortcutGate } from "./gate.js";
import { bindingFromEvent } from "./keys.js";
import { createKeymap, OPEN_MENU } from "./keymap.js";
import { liveKeybindings } from "./profiles.js";

export { OPEN_MENU };

// The central shortcut dispatcher. It owns the keymap (catalog + current
// platform + overrides) and a live handler registry keyed by action id. For
// each key event it resolves exactly one winning action:
//   1. the gate decides whether menu actions may run at all (gate.js);
//   2. the event becomes one canonical binding (keys.js);
//   3. among actions bound to it, only those in contexts eligible for the
//      current state are candidates, and the most specific tier wins
//      (overlay > drawer > page > global, see contexts.js).
// The winner's most recently registered handler runs; registration order
// never chooses between different actions.
//
// `keybindings` is the saved state from GetKeybindings ({ config, problem });
// the active profile's variant for the current platform is live, or the
// factory bindings when it is unusable (`problem` in the snapshot says why).
// `overrides` (keyed by platform variant: { macos: {id: [...]}, ... }) sets
// raw overrides directly and is used when no `keybindings` are given.
export function createDispatcher({ catalog, platform, overrides = {}, keybindings = null }) {
  let keymap;
  let problem = "";
  const handlers = new Map();
  const subscribers = new Set();

  function snapshot() {
    return {
      catalog: keymap.catalog,
      platform: keymap.platform,
      bindingsFor: keymap.bindingsFor,
      problem,
    };
  }

  function configure(next = {}) {
    catalog = next.catalog ?? catalog;
    platform = next.platform ?? platform;
    overrides = next.overrides ?? overrides;
    keybindings = next.keybindings ?? keybindings;
    const live = keybindings
      ? liveKeybindings(keybindings, catalog, platform)
      : { overrides: overrides[platform] ?? {}, problem: "" };
    problem = live.problem;
    keymap = createKeymap(catalog, platform, live.overrides, { knownActions: live.knownActions });
    const current = snapshot();
    for (const fn of subscribers) fn(current);
  }

  function resolve(event, state) {
    const gate = shortcutGate(event, state);
    if (gate === "blocked") return null;
    const binding = bindingFromEvent(event);
    if (!binding) return null;
    const bound = keymap.actionsFor(binding);
    if (!bound.length) return null;
    if (gate === "menu-only") return bound.includes(OPEN_MENU) ? OPEN_MENU : null;
    for (const contextId of eligibleContextIds(state, keymap.catalog.contexts)) {
      const winner = bound.find((id) => keymap.catalog.get(id).context === contextId);
      if (winner) return winner;
    }
    return null;
  }

  function handlerFor(actionId) {
    return handlers.get(actionId)?.at(-1);
  }

  function run(actionId) {
    const handler = handlerFor(actionId);
    if (!handler) return false;
    handler();
    return true;
  }

  // Runs the winning action for a keydown event. Returns true and consumes
  // the event when an action ran.
  function dispatch(event, state) {
    const actionId = resolve(event, state);
    if (!actionId || !handlerFor(actionId)) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    return run(actionId);
  }

  // Registers the live handler for an action. Returns a function that
  // removes exactly this registration.
  function register(actionId, handler) {
    if (!handlers.has(actionId)) handlers.set(actionId, []);
    handlers.get(actionId).push(handler);
    return () => {
      const stack = handlers.get(actionId);
      const index = stack?.lastIndexOf(handler) ?? -1;
      if (index !== -1) stack.splice(index, 1);
    };
  }

  // Svelte store contract: called now and after every configure().
  function subscribe(fn) {
    subscribers.add(fn);
    fn(snapshot());
    return () => subscribers.delete(fn);
  }

  configure();

  return {
    configure,
    resolve,
    dispatch,
    run,
    register,
    subscribe,
    bindingsFor: (actionId) => keymap.bindingsFor(actionId),
    get catalog() {
      return keymap.catalog;
    },
    get platform() {
      return keymap.platform;
    },
  };
}
