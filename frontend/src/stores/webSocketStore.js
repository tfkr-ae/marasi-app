// The app's WebSocket store, bound to the Wails backend. The logic
// lives in createWebSocketStore.js, which tests load with a fake API.
import { writable } from "svelte/store";
import {
	DropWSIntercepted,
	ForwardWSIntercepted,
	GetWebSocketConnection,
	GetWebSocketMessages,
	GetWSInterceptFlag,
	GetWSIntercepted,
	ToggleWSIntercept,
} from "../lib/bindings/github.com/tfkr-ae/marasi-app/app.js";
import { createWebSocketStore } from "./createWebSocketStore.js";

// Draft payload for the Inject tab (set via "Copy to Inject").
export const wsInjectDraft = writable(null);

export const webSocketStore = createWebSocketStore({
	DropWSIntercepted,
	ForwardWSIntercepted,
	GetWebSocketConnection,
	GetWebSocketMessages,
	GetWSInterceptFlag,
	GetWSIntercepted,
	ToggleWSIntercept,
});
