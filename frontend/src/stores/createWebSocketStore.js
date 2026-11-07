// The WebSocket modal's state: messages, connections, progress and each
// connection's Checkpoint queue, by upgrade request id. Every backend call
// goes through the injected `api` (see webSocketApi.js for the service's),
// so this module loads under node --test.
import { get, writable } from "svelte/store";
import { isCheckpointGone } from "../lib/checkpointHeld.js";
import { isSuperseded } from "../lib/service/errors.js";
import {
	applyProgress,
	clearProgress,
	finishMessage,
	holdMessage,
} from "../lib/websocket/progress.js";


export function createWebSocketStore(api) {
	const store = writable({
		messagesByRequestId: {},
		connectionsByRequestId: {},
		interceptionsByRequestId: {},
		interceptionLoadingByRequestId: {},
		interceptionProcessingByRequestId: {},
		interceptionErrorsByRequestId: {},
		wsInterceptEnabled: false,
		progressByRequestId: {},
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
				progressByRequestId: holdMessage(
					state.progressByRequestId,
					msg,
				),
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
			const intercepted = await api.GetWSIntercepted(requestId);
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

	// Takes a message that left Checkpoint off its connection's queue and
	// reads the queue's head again.
	async function settleInterception(requestId, id) {
		update((state) => ({
			...state,
			interceptionsByRequestId: {
				...state.interceptionsByRequestId,
				[requestId]: (
					state.interceptionsByRequestId[requestId] || []
				).filter((item) => item.ID !== id),
			},
		}));
		await populateInterception(requestId);
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
			try {
				if (action === "forward") {
					await api.ForwardWSIntercepted(
						intercepted.ID,
						intercepted.Opcode,
						payload,
					);
				} else {
					await api.DropWSIntercepted(intercepted.ID);
				}
			} catch (err) {
				// Forwarded or dropped elsewhere, such as the Checkpoint page.
				if (!isCheckpointGone(err)) throw err;
			}
			await settleInterception(requestId, intercepted.ID);
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

	async function populateInterceptFlag() {
		try {
			const enabled = await api.GetWSInterceptFlag();
			setInterceptFlag(enabled);
		} catch (err) {
			console.error("Loading WebSocket intercept state", err);
		}
	}

	function setInterceptFlag(enabled) {
		update((state) => ({ ...state, wsInterceptEnabled: enabled }));
	}

	async function populate(requestId) {
		if (!requestId) return;
		const [history, connection] = await Promise.all([
			api.GetWebSocketMessages(requestId),
			api.GetWebSocketConnection(requestId),
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
	}

	function upsertConnection(conn) {
		if (!conn?.RequestID) return;
		update((state) => ({
			...state,
			connectionsByRequestId: {
				...state.connectionsByRequestId,
				[conn.RequestID]: conn,
			},
			progressByRequestId:
				conn.State === "open"
					? state.progressByRequestId
					: clearProgress(
							state.progressByRequestId,
							conn.RequestID,
						),
		}));
	}

	// Replaces the connection's Checkpoint queue with its held head.
	async function rereadInterception(requestId) {
		const head = await api.GetWSIntercepted(requestId);
		update((state) => ({
			...state,
			interceptionsByRequestId: {
				...state.interceptionsByRequestId,
				[requestId]: head ? [head] : [],
			},
		}));
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
				progressByRequestId: {},
			}),

		upsertInterception,
		populateInterception,

		/**
		 * checkpoint.forwarded or checkpoint.dropped: a held message left,
		 * from here, the Checkpoint page or another client.
		 */
		onSettled: ({ ID, Type, RequestID } = {}) =>
			Type === "websocket" && RequestID
				? settleInterception(RequestID, ID)
				: Promise.resolve(),
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

		populateInterceptFlag,

		/** checkpoint.updated: the WebSocket intercept flag, from any client. */
		setInterceptFlag,

		toggleIntercept: async () => {
			try {
				const enabled = await api.ToggleWSIntercept();
				update((state) => ({
					...state,
					wsInterceptEnabled: enabled,
				}));
			} catch (err) {
				// A connection switch stopped it: nothing to report.
				if (!isSuperseded(err)) console.error("Toggling WebSocket intercept", err);
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
					progressByRequestId: finishMessage(
						state.progressByRequestId,
						msg,
					),
				};
			});
		},

		upsertConnection,

		upsertProgress: (record) => {
			if (!record?.RequestID) return;
			update((state) => ({
				...state,
				progressByRequestId: applyProgress(
					state.progressByRequestId,
					record,
					{
						messages: state.messagesByRequestId[record.RequestID],
						held: state.interceptionsByRequestId[record.RequestID],
						connection:
							state.connectionsByRequestId[record.RequestID],
					},
				),
			}));
		},

		populate,

		/**
		 * Injects a message on the upgrade's connection. Rejects with the
		 * service's refusal (websocket_not_open on a closed one).
		 */
		inject: (requestId, direction, opcode, payload, neverCompress) =>
			api.InjectWebSocketMessage(
				requestId,
				direction,
				opcode,
				payload,
				neverCompress,
			),

		/** Closes the upgrade's connection and keeps it as it closed. */
		close: async (requestId, code, reason) => {
			const conn = await api.CloseWebSocket(requestId, code, reason);
			if (conn) upsertConnection(conn);
		},

		/**
		 * After a reconnect: the flag, and each connection the modal has
		 * shown, read again; messages already shown stay.
		 */
		resync: async () => {
			const state = get(store);
			const requestIds = new Set([
				...Object.keys(state.messagesByRequestId),
				...Object.keys(state.connectionsByRequestId),
				...Object.keys(state.interceptionsByRequestId),
			]);
			await Promise.all([
				populateInterceptFlag(),
				...[...requestIds].map((requestId) =>
					Promise.all([
						populate(requestId),
						rereadInterception(requestId),
					]),
				),
			]);
		},
	};
}

