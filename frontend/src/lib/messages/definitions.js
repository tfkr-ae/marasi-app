// Each message kind's definition for the Messages modal, by kind id
// (MESSAGE_KINDS in kinds.js). A new kind adds its entry here; the shell,
// MessagesModal.svelte, needs no change.
import { kindOf } from "./kinds.js";
import { websocketKind } from "./websocket.js";

const DEFINITIONS = {
	websocket: websocketKind,
};

// The definition for a modal's meta.
export function definitionFor(meta) {
	return DEFINITIONS[kindOf(meta).id];
}
