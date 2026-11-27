// What the Ledger drawer shows of the focused pair: its request and response
// text, whether the editors highlight it, its timing, and what it is linked
// to.
import { prettifiedBody } from "../prettified.js";

/** Bodies at least this long are not highlighted under the "auto" syntax mode. */
export const SYNTAX_AUTO_LIMIT = 75_000;

/**
 * The request and response text from the full pair read (GetRawDetails):
 * Marasi's prettified copies when `prettify` is on and it has them, else
 * the raw text. `incomingResponse`, a response that arrived after the pair
 * was selected, replaces the one read with it. `joinedResponse`, when given
 * (an ended SSE pair's joined response), is shown in both Prettify modes.
 */
export function drawerBodies(details, { prettify, incomingResponse = null, joinedResponse = null }) {
  const pretty = (part) => (prettify ? prettifiedBody(details, part) : null);
  const request = pretty("request") ?? details?.Request?.Raw ?? "";
  const response =
    joinedResponse != null
      ? joinedResponse
      : incomingResponse
        ? (prettify && incomingResponse.Prettified) || incomingResponse.Raw || ""
        : (pretty("response") ?? details?.Response?.Raw ?? "");
  return { request, response };
}

/**
 * Whether an editor highlights `body` as HTTP under the Syntax setting
 * ("enabled", "disabled", or "auto", which stops at SYNTAX_AUTO_LIMIT).
 * Nothing is highlighted before the settings load.
 */
export function usesSyntax(body, mode) {
  if (!body) return false;
  if (mode === "enabled") return true;
  if (mode === "auto") return body.length < SYNTAX_AUTO_LIMIT;
  return false;
}

/**
 * The time from a pair's request to its response, "77 ms" or "1.24 s"; ""
 * while it has none (Marasi's zero time reads as none).
 */
export function pairTiming(pair) {
  const requested = Date.parse(pair?.RequestedAt);
  const responded = Date.parse(pair?.RespondedAt);
  if (!(requested > 0) || !(responded >= requested)) return "";
  const ms = responded - requested;
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
}

/** The findings or test cases (each with `Requests`) that list pair `id`. */
export function linkedTo(id, records) {
  return (records ?? []).filter((record) => (record.Requests ?? []).some((request) => String(request) === String(id)));
}

/** A pair's metadata as indented JSON, as the metadata modal showed it. */
export function metadataText(metadata) {
  if (metadata == null) return "";
  if (typeof metadata === "string") return metadata;
  try {
    return JSON.stringify(metadata, null, 2);
  } catch {
    return String(metadata);
  }
}
