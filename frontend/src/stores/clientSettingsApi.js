// The app's per-project settings, stored in the open project on the service
// under the client `marasi-app` (docs/adr/2026-10-16-app-defaults-with-project-overrides.md).
// The service publishes no event when one changes, so whoever writes one
// updates its own store after the write.

/** The client name the app's project settings live under. */
export const APP_CLIENT = "marasi-app";

const settingPath = (key) => `/client-settings/${APP_CLIENT}/${key.split("/").map(encodeURIComponent).join("/")}`;

/**
 * `{list, get, set, delete}` over `client`. Settings are
 * `{client, key, value, updated_at}`; `get` resolves to null for a key the
 * project doesn't have, and deleting a missing key is no error.
 */
export function createClientSettings(client) {
  return {
    /** The settings whose keys start with `prefix`, sorted by key. */
    async list(prefix = "") {
      const answer = await client.get(`/client-settings/${APP_CLIENT}`, prefix ? { prefix } : undefined);
      return answer?.items ?? [];
    },
    async get(key) {
      try {
        return await client.get(settingPath(key));
      } catch (err) {
        if (err?.code === "not_found") return null;
        throw err;
      }
    },
    set: (key, value) => client.put(settingPath(key), { value }),
    delete: async (key) => {
      await client.del(settingPath(key));
    },
  };
}
