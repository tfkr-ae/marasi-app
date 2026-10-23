// What an intercepted item doesn't carry itself, read once per item: the
// stored request a held response answers (GetRawDetails), and a WebSocket
// message's connection (GetWebSocketConnection). A held request has neither:
// Marasi stores it only once it is forwarded.
import { writable } from "svelte/store";

const RETRIES = 3;
const RETRY_MS = 500;

/**
 * `api` is { getRow(id), getConnection(id) }. The store maps
 * "<Type>:<ID>" to { request } or { connection }; keyOf gives the key.
 */
export function createItemContext(api) {
  const store = writable({});
  const asked = new Set();

  async function read(item, key, attempt = 0) {
    let context = null;
    try {
      if (item.Type === "response") {
        const row = await api.getRow(item.ID);
        if (row?.Request) context = { request: row.Request };
      } else {
        const connection = await api.getConnection(item.RequestID || item.ConnectionID);
        if (connection) context = { connection };
      }
    } catch (err) {
      console.error("Reading a Checkpoint item's context failed:", err);
    }
    if (context) {
      store.update((byKey) => ({ ...byKey, [key]: context }));
    } else if (attempt + 1 < RETRIES) {
      // A response can be held before its request's write lands.
      setTimeout(() => read(item, key, attempt + 1), RETRY_MS);
    }
  }

  /** Reads the context of each item not read yet. */
  function load(items) {
    for (const item of items) {
      if (item.Type === "request") continue;
      const key = keyOf(item);
      if (asked.has(key)) continue;
      asked.add(key);
      read(item, key);
    }
  }

  return { subscribe: store.subscribe, load };
}

/** The context store's key for an item; a held response reuses its request's id. */
export const keyOf = (item) => `${item.Type}:${item.ID}`;
