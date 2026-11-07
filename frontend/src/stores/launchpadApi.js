// Launchpad's api over the service client: each call reads or writes a
// control API route and maps its snake_case answer to the PascalCase shape
// createLaunchpadStore keeps, which the Launchpad page and its helpers read.
// What the Go bindings did on top of Marasi lives here too: a cancel that
// lost the race to the launch's end, which is no error.
// The mapper for launch stream events (toLaunch; traffic events use
// trafficApi.js's toRequestEvent and toResponseEvent) is
// exported for launchpadStore.js.
import { encodeBase64Text } from "../lib/service/bytes.js";
import { toDetails } from "./trafficApi.js";

/** A launchpad from GET /launchpad, in the store's fields. */
export function toLaunchpad(launchpad) {
  return {
    ID: launchpad.id,
    Name: launchpad.name,
    Description: launchpad.description ?? "",
    EntryCount: launchpad.entry_count,
    LastStatusCode: launchpad.last_status_code ?? null,
  };
}

/** A launch record, from GET /launch… or a launch.* event. */
export function toLaunch(launch) {
  return {
    ID: launch.launch_id,
    LaunchpadID: launch.launchpad_id,
    Status: launch.status,
    Reason: launch.reason ?? "",
  };
}

/** A TrafficSummary as an entry-list row. */
export function toEntry(item) {
  return {
    ID: item.id,
    Number: item.number,
    Scheme: item.scheme,
    Method: item.method,
    Host: item.host,
    Path: item.path,
    Status: item.status ?? "",
    StatusCode: item.status_code ?? 0,
    ContentType: item.content_type ?? "",
    Length: item.length ?? "",
    Metadata: item.metadata ?? {},
    RequestedAt: item.requested_at,
    RespondedAt: item.responded_at ?? null,
    Highlight: item.highlight ?? null,
    Note: item.note ?? "",
  };
}

/**
 * GET /traffic/{id} as the details the store keeps (trafficApi's
 * toDetails), with Response null until one arrives.
 */
function toLaunchpadDetails(pair) {
  const details = toDetails(pair);
  const answered = pair.response && pair.response.status_code !== -1;
  return answered ? details : { ...details, Response: null };
}

// An invalid_query refusal as the QueryError data the store reads, or null
// for any other error. The position is in the researcher's text.
function queryErrorOf(err) {
  if (err?.code !== "invalid_query") return null;
  return { Message: err.body?.message ?? String(err), Position: err.body?.position ?? 0 };
}

const isNotFound = (err) => err?.code === "not_found";

// The target of a bulk link or unlink to a finding or test case.
const recordTarget = ({ Kind, ID }) => (Kind === "test_case" ? { test_case_id: ID } : { finding_id: ID });

export function createLaunchpadApi(client) {
  return {
    async getLaunchpads() {
      const list = await client.get("/launchpad");
      return (list.items ?? []).map(toLaunchpad);
    },
    async getEntries(id) {
      const launchpad = await client.get(`/launchpad/${id}`);
      return (launchpad.items ?? []).map(toEntry);
    },
    // Null for a pair the service can't find, as the binding gave.
    async getRawDetails(id) {
      try {
        return toLaunchpadDetails(await client.get(`/traffic/${id}`));
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },
    // An entry's note, "" when it has none.
    async getNote(id) {
      try {
        return (await client.get(`/notes/${id}`)).note ?? "";
      } catch (err) {
        if (isNotFound(err)) return "";
        throw err;
      }
    },
    getMetadata: (id) => client.get(`/traffic/${id}/metadata`),
    async createLaunchpad(name, description) {
      const created = await client.post("/launchpad", { name, description });
      return created.id;
    },
    updateLaunchpad: (id, name, description) => client.post(`/launchpad/${id}`, { name, description }),
    deleteLaunchpad: (id) => client.del(`/launchpad/${id}`),

    // Returns the launch id, which is also the new entry's id.
    async launch(raw, launchpadId, useHttps) {
      const started = await client.post(`/launchpad/${launchpadId}/launch`, {
        raw: encodeBase64Text(raw),
        scheme: useHttps ? "https" : "http",
      });
      return started.launch_id;
    },
    // A launch that ended before the cancel reached it comes back in its
    // final state, with no error.
    async cancelLaunch(id) {
      try {
        return toLaunch(await client.post(`/launch/${id}/cancel`));
      } catch (err) {
        if (err?.code === "launch_finished" && err.body) return toLaunch(err.body);
        throw err;
      }
    },
    getLaunch: async (id) => toLaunch(await client.get(`/launch/${id}`)),
    async pendingLaunches() {
      const list = await client.get("/launch");
      return (list.items ?? []).map(toLaunch);
    },

    // Runs a traffic query over every launchpad's entries:
    // { EntriesByLaunchpad: { [launchpadId]: [entry ids in entry order] },
    //   QueryError: { Message, Position } | null }. A pair maps to every
    // launchpad that holds it, linked originals included.
    async searchEntries(query) {
      try {
        const matches = await client.get("/launchpad/search", { q: query });
        return { EntriesByLaunchpad: matches ?? {}, QueryError: null };
      } catch (err) {
        const queryError = queryErrorOf(err);
        if (!queryError) throw err;
        return { EntriesByLaunchpad: {}, QueryError: queryError };
      }
    },

    // Returns the moved ids in their new entry order.
    async moveEntries(sourceId, targetId, ids, before) {
      const body = { request_ids: ids, target_launchpad_id: targetId };
      if (before) body.before_request_id = before;
      const moved = await client.post(`/launchpad/${sourceId}/move`, body);
      return moved.request_ids ?? [];
    },
    // Returns how many entries the service removed.
    async unlinkEntries(launchpadId, ids) {
      const done = await client.post("/traffic/bulk/unlink", { selection: { ids }, launchpad_id: launchpadId });
      return done.count;
    },
    // `target` is { Kind: "finding" | "test_case", ID }. Return the count.
    async linkEntriesToRecord(selection, target) {
      const done = await client.post("/traffic/bulk/link", { selection, ...recordTarget(target) });
      return done.count;
    },
    async unlinkEntriesFromRecord(selection, target) {
      const done = await client.post("/traffic/bulk/unlink", { selection, ...recordTarget(target) });
      return done.count;
    },
  };
}
