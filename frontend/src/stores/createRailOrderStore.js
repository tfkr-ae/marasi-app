// App-wide rail order store factory. Backend calls go through the injected
// `api` ({ get, save, reset }) so unit tests run without Wails bindings.
import { derived, writable } from "svelte/store";
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

  // Track the last confirmed persisted state separately from optimistic updates
  // and guard overlapping writes with a monotonic generation counter so a stale
  // failure never clobbers a newer confirmed save or restores unpersisted state.
  let lastPersisted = [];
  let lastPersistedSeq = 0;
  let writeSeq = 0;

  async function read() {
    const seq = writeSeq;
    try {
      const saved = await api.get();
      const confirmed = Array.isArray(saved) ? [...saved] : [];
      if (seq === writeSeq) {
        lastPersisted = confirmed;
        lastPersistedSeq = seq;
        savedOrder.set([...confirmed]);
      }
    } catch (error) {
      console.error("reading rail order, using default:", error);
    }
  }

  async function reset() {
    const seq = ++writeSeq;
    savedOrder.set([]);
    try {
      await api.reset();
      if (seq >= lastPersistedSeq) {
        lastPersisted = [];
        lastPersistedSeq = seq;
      }
      if (seq === writeSeq) {
        savedOrder.set([]);
      }
      return resolveRailOrder([]);
    } catch (error) {
      if (seq === writeSeq) {
        savedOrder.set([...lastPersisted]);
      }
      throw error;
    }
  }

  async function save(nextIds) {
    const next = resolveRailOrder(nextIds);
    if (isDefaultRailOrder(next)) {
      return reset();
    }
    const seq = ++writeSeq;
    savedOrder.set(next);
    try {
      const saved = await api.save(next);
      const confirmed = Array.isArray(saved) ? [...saved] : [...next];
      if (seq >= lastPersistedSeq) {
        lastPersisted = confirmed;
        lastPersistedSeq = seq;
      }
      if (seq === writeSeq) {
        savedOrder.set([...confirmed]);
      }
      return resolveRailOrder(confirmed);
    } catch (error) {
      if (seq === writeSeq) {
        savedOrder.set([...lastPersisted]);
      }
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
