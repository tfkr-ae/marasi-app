// The Ledger's api over the service client: the object createLedgerStore
// takes, each call a control API route (or a few) mapped to the shapes the
// store reads. The content-type exclusion is the app's: `exclusion`
// (contentTypeExclusion.js) passes it on every traffic read.
import { countTraffic, readTraffic, toDetails } from "./trafficApi.js";

// The body key that names a link target, by the store's target kind.
const TARGET_KEYS = { launchpad: "launchpad_id", finding: "finding_id", test_case: "test_case_id" };

function targetBody(target) {
  const key = TARGET_KEYS[target.Kind];
  if (!key) throw new Error(`Unknown link target: ${target.Kind}`);
  return { [key]: target.ID };
}

// Resolves to null when the service answers not_found.
async function orNull(promise) {
  try {
    return await promise;
  } catch (err) {
    if (err?.code === "not_found") return null;
    throw err;
  }
}

/**
 * A websocket.opened, .closed or .handshake_ended event as the upgrade
 * row's patch reads it (webSocketMetadataPatch): fields the event lacks
 * stay out.
 */
export function toUpgradeEvent(conn) {
  const event = { RequestID: conn.request_id, State: conn.state };
  if (conn.transport !== undefined) event.Transport = conn.transport;
  if (conn.close_code !== undefined) event.CloseCode = conn.close_code;
  if (conn.close_reason !== undefined) event.CloseReason = conn.close_reason;
  return event;
}

export function createLedgerApi(client, { exclusion }) {
  const excluded = (ignore) => (ignore ? null : exclusion.effective());
  // A bulk change: resolves to how many pairs changed.
  const bulk = async (route, body) => (await client.post(`/traffic/bulk/${route}`, body)).count;

  return {
    /** The client bound to its connection now, for a multi-step action (boundAction.js). */
    bind: () => client.bind?.(),
    // A page of the live view or of a query's results:
    // { Query, OrderBy, Cursor, Direction, AsOf, Limit, IgnoreExclusion }.
    queryTraffic: async (request) => readTraffic(client, request, await excluded(request.IgnoreExclusion)),
    // after: "" counts every match, else only pairs captured after that id.
    // options: { AsOf, IgnoreExclusion }; AsOf counts only pairs up to it.
    countTraffic: async (query, after, options = {}) =>
      countTraffic(client, { query, after, asOf: options.AsOf }, await excluded(options.IgnoreExclusion)),
    /** Reads the project's exclusion afresh on the next read. */
    forgetExclusion: () => exclusion.forget(),

    getExclusion: () => exclusion.effective(),
    setExclusion: (types) => exclusion.set(types),
    // False when the project follows the app default.
    hasOwnExclusion: () => exclusion.hasOwn(),
    resetExclusion: () => exclusion.reset(),
    getDefaultExclusion: () => exclusion.getDefault(),
    setDefaultExclusion: (types) => exclusion.setDefault(types),

    async countContentTypes() {
      const counted = await client.get("/traffic/content-types");
      return {
        Counts: (counted.items ?? []).map((item) => ({ ContentType: item.content_type, Count: item.count })),
        Complete: { sitemap: counted.sitemap?.complete ?? true },
      };
    },
    // The full pair, or null when it's gone.
    getRawDetails: async (id) => {
      const pair = await orNull(client.get(`/traffic/${id}`));
      return pair && toDetails(pair);
    },
    getMetadata: (id) => client.get(`/traffic/${id}/metadata`),
    // "" when the pair has no note.
    getNote: async (id) => (await orNull(client.get(`/notes/${id}`)))?.note ?? "",
    // The service refuses an empty note: emptying it deletes it.
    updateNote: async (id, text) => {
      if (text === "") await client.del(`/notes/${id}`);
      else await client.put(`/notes/${id}`, { note: text });
    },

    // A selection is Marasi's: { ids }, or { query, exclusion, as_of } after
    // ⌘A. Each bulk call resolves to how many pairs changed.
    setHighlight: (selection, highlight) => bulk("highlight", { selection, highlight }),
    clearHighlight: (selection) => bulk("highlight", { selection, highlight: null }),
    // target: { Kind: "launchpad" | "finding" | "test_case", ID }.
    linkTraffic: (selection, target) => bulk("link", { selection, ...targetBody(target) }),
    unlinkTraffic: (selection, target) => bulk("unlink", { selection, ...targetBody(target) }),
    appendNote: (selection, text) => bulk("note", { selection, append: text }),
    clearNotes: (selection) => bulk("note", { selection, clear: true }),
    deleteTraffic: (selection) => bulk("delete", { selection }),

    // Resolves to the new launchpad's id.
    createLaunchpad: async (name, description) => (await client.post("/launchpad", { name, description })).id,
    deleteLaunchpad: (id) => client.del(`/launchpad/${id}`),
  };
}
