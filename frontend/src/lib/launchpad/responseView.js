// What the Launchpad workspace's Response pane shows for the selected entry.
import { hasJoinedSSEEvents } from "../../stores/createJoinedResponseStore.js";

/**
 * Resolves the Launchpad response pane's display state:
 * - `kind`: "empty" | "loading" | "waiting" | "ended-empty" | "response"
 * - `text`: text for CodeMirror when `kind === "response"`
 * - `endText`: terminal status label ("Cancelled", "Failed: …") when relevant
 * - `endMessage`: empty-state copy when `kind === "ended-empty"`
 *
 * A cancelled (or failed) launch that captured complete SSE events shows both
 * its terminal status and the joined response; a launch that received no
 * response (or no complete events) preserves the existing no-response state.
 */
export function launchpadResponseView({ selectedId, details, endText, joinedResponse = null }) {
  if (endText) {
    if (hasJoinedSSEEvents(joinedResponse)) {
      return { kind: "response", text: joinedResponse, endText, endMessage: null };
    }
    return {
      kind: "ended-empty",
      text: "",
      endText,
      endMessage: endText === "Cancelled" ? "Cancelled — no response" : endText,
    };
  }
  if (joinedResponse != null) {
    return { kind: "response", text: joinedResponse, endText: null, endMessage: null };
  }
  if (details && !details.Response) {
    return { kind: "waiting", text: "", endText: null, endMessage: null };
  }
  if (details?.Response) {
    return { kind: "response", text: details.Response.Raw ?? "", endText: null, endMessage: null };
  }
  if (selectedId) {
    return { kind: "loading", text: "", endText: null, endMessage: null };
  }
  return { kind: "empty", text: "", endText: null, endMessage: null };
}
