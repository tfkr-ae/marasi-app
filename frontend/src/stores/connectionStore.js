// The app's WebSocket connection store, bound to the v1 bindings. The logic
// lives in createConnectionStore.js, which tests load with a fake API.
import { writable } from "svelte/store";
import {
	DropWSIntercepted,
	ForwardWSIntercepted,
	GetWebSocketConnection,
	GetWebSocketMessages,
	GetWSInterceptFlag,
	GetWSIntercepted,
	ToggleWSIntercept,
} from "../lib/bindings/App";
import { createConnectionStore } from "./createConnectionStore.js";

// Draft payload for the Inject tab (set via "Copy to Inject").
export const wsInjectDraft = writable(null);

export const connectionStore = createConnectionStore({
	DropWSIntercepted,
	ForwardWSIntercepted,
	GetWebSocketConnection,
	GetWebSocketMessages,
	GetWSInterceptFlag,
	GetWSIntercepted,
	ToggleWSIntercept,
});
