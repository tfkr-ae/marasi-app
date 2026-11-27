// App-wide rail order store factory. Backend calls go through the injected
// `api` ({ get, save, reset }) so unit tests run without Wails bindings.
import { derived, get, writable } from "svelte/store";
import {
  isDefaultRailOrder,
  resolveRailOrder,
  resolveRailPages,
} from "../lib/railOrder.js";

export function createRailOrderStore(api) {
  /** Raw saved page ids from app config ([] when uncustomized). */
  const savedOrder = writable([]);
  /** Resolved ordered list of the 10 built-in page ids below Home. */
  const railOrder = derived(savedOrder, ($saved) => resolveRailOrder($saved));
  /** Resolved ordered list of the 10 built-in page definitions below Home. */
  const railPages = derived(savedOrder, ($saved) => resolveRailPages($saved));
  /** True when the current rail order matches the canonical default order. */
  const isDefault = derived(railOrder, ($order) => isDefaultRailOrder($order));

  async function read() {
    try {
      const saved = await api.get();
      savedOrder.set(Array.isArray(saved) ? saved : []);
    } catch (error) {
      console.error("reading rail order, using default:", error);
    }
  }

  async function reset() {
    const before = get(savedOrder);
    savedOrder.set([]);
    try {
      await api.reset();
      savedOrder.set([]);
      return resolveRailOrder([]);
    } catch (error) {
      savedOrder.set(before);
      throw error;
    }
  }

  async function save(nextIds) {
    const next = resolveRailOrder(nextIds);
    if (isDefaultRailOrder(next)) {
      return reset();
    }
    const before = get(savedOrder);
    savedOrder.set(next);
    try {
      const saved = await api.save(next);
      const confirmed = Array.isArray(saved) ? saved : next;
      savedOrder.set(confirmed);
      return resolveRailOrder(confirmed);
    } catch (error) {
      savedOrder.set(before);
      throw error;
    }
  }

  return {
    savedOrder,
    railOrder,
    railPages,
    isDefault,
    read,
    save,
    reset,
  };
}
