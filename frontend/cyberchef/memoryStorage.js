// The in-memory localStorage CyberChef's frame gets before any of its own
// scripts run (build.js injects it at the top of its index.html). CyberChef
// is served from the app's origin, so its own localStorage would be the
// app's: its options, theme and saved recipes would land there. With this,
// everything it stores lives only as long as the frame.
//
// installMemoryStorage is serialised into the page with toString(), so it
// uses nothing from outside its own body.

/** Replaces `win.localStorage` with a Storage held in memory; returns it. */
export function installMemoryStorage(win) {
  const items = new Map();
  const methods = {
    getItem: (key) => (items.has(String(key)) ? items.get(String(key)) : null),
    setItem: (key, value) => {
      items.set(String(key), String(value));
    },
    removeItem: (key) => {
      items.delete(String(key));
    },
    clear: () => {
      items.clear();
    },
    key: (index) => [...items.keys()][index] ?? null,
  };
  // A Proxy, so `localStorage.name` reads and writes an item as a real
  // Storage does.
  const storage = new Proxy(
    {},
    {
      get(_, name) {
        if (name === "length") return items.size;
        if (typeof name === "symbol") return undefined;
        if (Object.prototype.hasOwnProperty.call(methods, name)) return methods[name];
        return items.has(name) ? items.get(name) : undefined;
      },
      set(_, name, value) {
        if (typeof name !== "symbol") items.set(name, String(value));
        return true;
      },
      deleteProperty(_, name) {
        items.delete(String(name));
        return true;
      },
      has: (_, name) => items.has(String(name)),
      ownKeys: () => [...items.keys()],
      getOwnPropertyDescriptor: (_, name) =>
        items.has(String(name))
          ? { value: items.get(String(name)), writable: true, enumerable: true, configurable: true }
          : undefined,
    },
  );
  Object.defineProperty(win, "localStorage", { value: storage, configurable: true, enumerable: true });
  return storage;
}

/** The <script> build.js puts first in CyberChef's <head>. */
export const MEMORY_STORAGE_SCRIPT = `<script data-marasi="memory-storage">(${installMemoryStorage.toString()})(window);</script>`;

/** CyberChef's index.html with MEMORY_STORAGE_SCRIPT first in its <head>. */
export function withMemoryStorage(html) {
  if (html.includes('data-marasi="memory-storage"')) return html;
  const head = /<head[^>]*>/i.exec(html);
  if (!head) throw new Error("CyberChef's index.html has no <head>");
  const at = head.index + head[0].length;
  return `${html.slice(0, at)}${MEMORY_STORAGE_SCRIPT}${html.slice(at)}`;
}
