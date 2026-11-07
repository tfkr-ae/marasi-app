// Checkpoint's api over the service client: the /checkpoint routes, mapped
// to the shape createCheckpointStore keeps (PascalCase, as the Wails
// bindings gave it). The mappers for stream events live here too, so one
// file knows the API's shapes.
import { isCheckpointGone } from "../lib/checkpointHeld.js";
import { httpParseError } from "../lib/checkpoint/httpParse.js";
import { isSuperseded } from "../lib/service/errors.js";

/** The text's UTF-8 bytes in base64, as the API takes a Go []byte. */
export function encodeText(text) {
  const bytes = new TextEncoder().encode(text ?? "");
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

/** A held item, from GET /checkpoint or checkpoint.held. */
export function toCheckpointItem(item) {
  const common = { ID: item.id, Type: item.type, InterceptedAt: item.intercepted_at };
  if (item.type !== "websocket") return { ...common, Raw: item.raw ?? "" };
  return {
    ...common,
    Payload: item.payload ?? "",
    Opcode: item.opcode,
    Direction: item.direction,
    ConnectionID: item.connection_id,
    RequestID: item.request_id,
    FrameCount: item.frame_count,
    Compressed: item.compressed,
    Metadata: item.metadata ?? {},
  };
}

/** checkpoint.forwarded or checkpoint.dropped. */
export const toSettled = (event) => ({
  ID: event.id,
  Type: event.type,
  RequestID: event.request_id ?? null,
  Reason: event.reason,
});

// The forward body: `raw` for an HTTP item, `payload` for a WebSocket
// message, nothing for an unedited item. Marasi refuses an empty body.
function forwardBody(type, body, interceptResponse) {
  const out = {};
  if (body) out[type === "websocket" ? "payload" : "raw"] = encodeText(body);
  if (interceptResponse && type === "request") out.intercept_response = true;
  return out;
}

const counts = (result) => ({ Done: result?.done ?? 0, Gone: result?.gone ?? 0, Failed: result?.failed ?? 0 });

export function createCheckpointApi(client) {
  const read = () => client.get("/checkpoint");
  const forward = (id, body, interceptResponse, type, link = client) =>
    link.post(`/checkpoint/${id}/forward`, forwardBody(type, body, interceptResponse));

  return {
    getItems: async () => ((await read()).items ?? []).map(toCheckpointItem),
    checkParse: (text, type) => httpParseError(text, type),
    forward,
    drop: (id) => client.post(`/checkpoint/${id}/drop`, {}),
    // The bulk route forwards the bytes as held, so each edited item goes
    // on its own; an item gone by then counts as gone, any other refusal as
    // failed (it stays held). The calls are bound to the connection the
    // first went to: once the app leaves it, the rest go nowhere.
    async forwardMany(items) {
      const link = client.bind?.() ?? client;
      const total = { Done: 0, Gone: 0, Failed: 0 };
      for (const item of items.filter((i) => i.Body)) {
        try {
          await forward(item.ID, item.Body, false, item.Type, link);
          total.Done++;
        } catch (err) {
          if (isSuperseded(err)) return total;
          if (isCheckpointGone(err)) total.Gone++;
          else {
            console.error(`Forwarding Checkpoint item ${item.ID} failed:`, err);
            total.Failed++;
          }
        }
      }
      const ids = items.filter((i) => !i.Body).map((i) => i.ID);
      if (ids.length) {
        let result;
        try {
          result = counts(await link.post("/checkpoint/forward", { ids }));
        } catch (err) {
          if (isSuperseded(err)) return total;
          throw err;
        }
        for (const key of Object.keys(total)) total[key] += result[key];
      }
      return total;
    },
    dropMany: async (ids) => counts(await client.post("/checkpoint/drop", { ids })),
    getInterceptFlag: async () => (await read()).intercept === true,
    async toggleIntercept() {
      const { intercept } = await read();
      return (await client.post("/checkpoint/intercept", { intercept: !intercept })).intercept === true;
    },
  };
}
