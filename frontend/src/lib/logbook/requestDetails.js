// Linked requests as the Logbook shows them, read once per pair with
// GetRawDetails and kept for the rest of the session.
import { GetRawDetails } from "../wailsjs/go/main/App";

const cache = new Map();

/** The full pair for request `id` (GetRawDetails), or null when it can't be read. */
export function requestDetails(id) {
  const key = String(id);
  if (!cache.has(key))
    cache.set(
      key,
      GetRawDetails(id).catch((error) => {
        console.error("Reading the request failed:", error);
        cache.delete(key);
        return null;
      }),
    );
  return cache.get(key);
}

/** A pair's list row: { number, method, url, status }. */
export function requestRow(details) {
  const request = details?.Request ?? {};
  return {
    number: request.Number ?? null,
    method: request.Method ?? "",
    url: `${request.Host ?? ""}${request.Path ?? ""}`,
    status: details?.Response?.StatusCode ?? 0,
  };
}

/** A request picker option's list row. */
export function optionRow(option) {
  return {
    number: option.Number ?? null,
    method: option.Method ?? "",
    url: `${option.Host ?? ""}${option.Path ?? ""}`,
    status: option.StatusCode ?? 0,
  };
}
