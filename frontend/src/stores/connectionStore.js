import { get, writable } from "svelte/store";
import {
	DropWSIntercepted,
	ForwardWSIntercepted,
	GetWebSocketConnection,
	GetWebSocketMessages,
	GetWSInterceptFlag,
	GetWSIntercepted,
	ToggleWSIntercept,
} from "../lib/wailsjs/go/main/App";

// Draft payload for the Inject tab (set via "Copy to Inject").
export const wsInjectDraft = writable(null);

function createConnectionStore() {
	const store = writable({
		messagesByRequestId: {},
		connectionsByRequestId: {},
		interceptionsByRequestId: {},
		interceptionLoadingByRequestId: {},
		interceptionProcessingByRequestId: {},
		interceptionErrorsByRequestId: {},
		wsInterceptEnabled: false,
	});
	const { subscribe, set, update } = store;

	function setInterceptionState(requestId, values) {
		update((state) => ({
			...state,
			...Object.fromEntries(
				Object.entries(values).map(([key, value]) => [
					key,
					{
						...state[key],
						[requestId]: value,
					},
				]),
			),
		}));
	}

	function upsertInterception(msg) {
		if (!msg?.RequestID) return;
		update((state) => {
			const queue = state.interceptionsByRequestId[msg.RequestID] || [];
			const index = queue.findIndex((item) => item.ID === msg.ID);
			const next =
				index >= 0
					? queue.map((item, i) => (i === index ? msg : item))
					: [...queue, msg];
			next.sort(
				(a, b) =>
					new Date(a.CreatedAt).getTime() -
					new Date(b.CreatedAt).getTime(),
			);
			return {
				...state,
				interceptionsByRequestId: {
					...state.interceptionsByRequestId,
					[msg.RequestID]: next,
				},
			};
		});
	}

	async function populateInterception(requestId) {
		if (!requestId) return;
		setInterceptionState(requestId, {
			interceptionLoadingByRequestId: true,
			interceptionErrorsByRequestId: "",
		});
		try {
			const intercepted = await GetWSIntercepted(requestId);
			if (intercepted) {
				upsertInterception(intercepted);
			}
		} catch (err) {
			setInterceptionState(requestId, {
				interceptionErrorsByRequestId: String(err),
			});
		} finally {
			setInterceptionState(requestId, {
				interceptionLoadingByRequestId: false,
			});
		}
	}

	async function resolveInterception(requestId, action, payload = "") {
		const intercepted =
			get(store).interceptionsByRequestId[requestId]?.[0];
		if (!intercepted) return;
		setInterceptionState(requestId, {
			interceptionProcessingByRequestId: true,
			interceptionErrorsByRequestId: "",
		});
		try {
			if (action === "forward") {
				await ForwardWSIntercepted(
					intercepted.ID,
					intercepted.Opcode,
					payload,
				);
			} else {
				await DropWSIntercepted(intercepted.ID);
			}
			update((state) => ({
				...state,
				interceptionsByRequestId: {
					...state.interceptionsByRequestId,
					[requestId]: (
						state.interceptionsByRequestId[requestId] || []
					).filter((item) => item.ID !== intercepted.ID),
				},
			}));
			await populateInterception(requestId);
		} catch (err) {
			setInterceptionState(requestId, {
				interceptionErrorsByRequestId: String(err),
			});
		} finally {
			setInterceptionState(requestId, {
				interceptionProcessingByRequestId: false,
			});
		}
	}

	return {
		subscribe,

		clear: () =>
			set({
				messagesByRequestId: {},
				connectionsByRequestId: {},
				interceptionsByRequestId: {},
				interceptionLoadingByRequestId: {},
				interceptionProcessingByRequestId: {},
				interceptionErrorsByRequestId: {},
				wsInterceptEnabled: false,
			}),

		upsertInterception,
		populateInterception,
		clearInterceptions: (requestId) => {
			if (!requestId) return;
			update((state) => ({
				...state,
				interceptionsByRequestId: {
					...state.interceptionsByRequestId,
					[requestId]: [],
				},
			}));
		},

		populateInterceptFlag: async () => {
			try {
				const enabled = await GetWSInterceptFlag();
				update((state) => ({
					...state,
					wsInterceptEnabled: enabled,
				}));
			} catch (err) {
				console.error("Loading WebSocket intercept state", err);
			}
		},

		toggleIntercept: async () => {
			try {
				const enabled = await ToggleWSIntercept();
				update((state) => ({
					...state,
					wsInterceptEnabled: enabled,
				}));
			} catch (err) {
				console.error("Toggling WebSocket intercept", err);
			}
		},

		forwardInterception: (requestId, payload) =>
			resolveInterception(requestId, "forward", payload),

		dropInterception: (requestId) =>
			resolveInterception(requestId, "drop"),

		upsertMessage: (msg) => {
			if (!msg?.RequestID) return;
			update((state) => {
				const list = state.messagesByRequestId[msg.RequestID] || [];
				const i = list.findIndex((m) => m.ID === msg.ID);
				const next =
					i >= 0
						? list.map((m, idx) => (idx === i ? msg : m))
						: [...list, msg];
				return {
					...state,
					messagesByRequestId: {
						...state.messagesByRequestId,
						[msg.RequestID]: next,
					},
				};
			});
		},

		upsertConnection: (conn) => {
			if (!conn?.RequestID) return;
			update((state) => ({
				...state,
				connectionsByRequestId: {
					...state.connectionsByRequestId,
					[conn.RequestID]: conn,
				},
			}));
		},

		populate: async (requestId) => {
			if (!requestId) return;
			const [history, connection] = await Promise.all([
				GetWebSocketMessages(requestId),
				GetWebSocketConnection(requestId),
			]);

			update((state) => {
				const existing = state.messagesByRequestId[requestId] || [];
				const byId = new Map();
				for (const m of history || []) byId.set(m.ID, m);
				for (const m of existing) byId.set(m.ID, m);

				return {
					...state,
					messagesByRequestId: {
						...state.messagesByRequestId,
						[requestId]: Array.from(byId.values()),
					},
					connectionsByRequestId: connection
						? {
								...state.connectionsByRequestId,
								[requestId]: connection,
							}
						: state.connectionsByRequestId,
				};
			});
		},
	};
}

export const connectionStore = createConnectionStore();
