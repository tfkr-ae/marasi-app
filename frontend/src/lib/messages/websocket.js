// The Messages modal's WebSocket kind: the parts of the modal a WebSocket
// connection supplies (its tabs and their menu actions, the header and its
// Close Connection action). The shell is MessagesModal.svelte; the pure parts
// (tab ids, contexts) are MESSAGE_KINDS.websocket in kinds.js.
import { derived } from "svelte/store";
import {
	ArrowDown,
	ArrowLeftRight,
	Braces,
	ChevronLeft,
	ChevronRight,
	CornerLeftDown,
	FlagIcon,
	Forward,
	Info,
	RadioIcon,
	RotateCw,
	SendIcon,
	ToggleLeft,
	Unplug,
} from "lucide-svelte";
import { isSuperseded } from "../service/errors.js";
import { websocketTab } from "../keybindings/app.js";
import { webSocketStore } from "../../stores/webSocketStore";
import { upgradeFromRequest, upgradePresentation } from "../websocket/presentation.js";
import { progressChip } from "../websocket/progress.js";
import { MESSAGE_KINDS } from "./kinds.js";
import WebSocketCheckpoint from "../components/WebSocketCheckpoint.svelte";
import WebSocketConnection from "../components/WebSocketConnection.svelte";
import WebSocketInject from "../components/WebSocketInject.svelte";
import WebSocketMessagesTable from "../components/WebSocketMessagesTable.svelte";

const base = MESSAGE_KINDS.websocket;

// Each tab's icon, component and menu actions. A menu action's `run`
// receives the tab's component instance.
const TABS = {
	stream: {
		icon: RadioIcon,
		component: WebSocketMessagesTable,
		menu: [
			{ actionId: "websocket.stream.previous-frame", icon: ChevronLeft, run: (tab) => tab.selectPreviousFrame() },
			{ actionId: "websocket.stream.next-frame", icon: ChevronRight, run: (tab) => tab.selectNextFrame() },
			{ actionId: "websocket.stream.jump-to-bottom", icon: ArrowDown, run: (tab) => tab.jumpToBottom() },
			{ actionId: "websocket.stream.toggle-frame-metadata", icon: Braces, run: (tab) => tab.toggleView() },
			{ actionId: "websocket.stream.copy-frame-to-inject", icon: SendIcon, run: (tab) => tab.copyToInject() },
		],
	},
	checkpoint: {
		icon: FlagIcon,
		component: WebSocketCheckpoint,
		menu: [
			{ actionId: "websocket.checkpoint.toggle-intercept", icon: ToggleLeft, run: (tab) => tab.toggleIntercept() },
			{ actionId: "websocket.checkpoint.forward-frame", icon: Forward, run: (tab) => tab.forward() },
			{ actionId: "websocket.checkpoint.drop-frame", icon: CornerLeftDown, run: (tab) => tab.drop() },
		],
	},
	inject: {
		icon: SendIcon,
		component: WebSocketInject,
		menu: [
			{ actionId: "websocket.inject.toggle-direction", icon: ArrowLeftRight, run: (tab) => tab.toggleDirection() },
			{ actionId: "websocket.inject.cycle-opcode", icon: RotateCw, run: (tab) => tab.cycleOpcode() },
			{ actionId: "websocket.inject.inject-frame", icon: SendIcon, run: (tab) => tab.inject() },
		],
	},
	// Read-only: only the shared modal actions.
	connection: { icon: Info, component: WebSocketConnection, menu: [] },
};

export const websocketKind = {
	...base,
	tabs: base.tabs.map((tab) => ({ ...tab, ...TABS[tab.id] })),
	// Where the modal publishes its open tab for the tab contexts.
	tabStore: websocketTab,
	previousTabAction: "websocket.previous-tab",
	nextTabAction: "websocket.next-tab",
	// One open modal's view of its connection. `meta` is the modal's meta,
	// `toastStore` the app's, and `openTab(id)` switches the modal's tab.
	session({ meta, toastStore, openTab }) {
		const request = meta?.upgradeRequest;
		const requestId = request?.Request?.ID || request?.ID || meta?.requestId;
		const view = derived(webSocketStore, ($ws) => {
			const connection = $ws.connectionsByRequestId[requestId];
			const upgrade = upgradePresentation(upgradeFromRequest(request, connection?.State));
			const transport = request?.Metadata?.["websocket.transport"] || connection?.Transport || "ws";
			const host = request?.Request?.Host || connection?.Host || "";
			const path = request?.Request?.Path || connection?.Path || "";
			const progress = $ws.progressByRequestId[requestId];
			return {
				upgrade,
				url: `${transport}://${host}${path}`,
				count: ($ws.messagesByRequestId[requestId] || []).length,
				chip: progress ? progressChip(progress) : null,
			};
		});

		return {
			header: derived(view, (v) => ({
				icon: RadioIcon,
				iconClass: v.upgrade.iconClass,
				title: v.url,
				count: `${v.count} messages`,
				chip: v.chip && `${v.chip.arrow} ${v.chip.label}`,
				chipTitle: "A message is still arriving; it appears in Stream once its last frame is in",
			})),
			action: {
				actionId: "websocket.close-connection",
				label: "Close Connection",
				busyLabel: "Closing…",
				icon: Unplug,
				enabled: derived(view, (v) => Boolean(requestId) && v.upgrade.state === "open"),
				async run() {
					try {
						await webSocketStore.close(requestId, 1000, "");
						toastStore.trigger({
							message: "WebSocket connection closed",
							background: "variant-filled-success",
						});
					} catch (error) {
						// A connection switch stopped it: nothing to report.
						if (isSuperseded(error)) return;
						toastStore.trigger({
							message: `Unable to close WebSocket connection: ${error}`,
							background: "variant-filled-error",
						});
					}
				},
			},
			// Each tab's props; a tab without props shows `missing`.
			tabProps: derived(view, (v) => ({
				stream: requestId && { requestId, onOpenInject: () => openTab("inject") },
				checkpoint: requestId && { requestId },
				inject: requestId && { requestId },
				connection: {
					requestId,
					request,
					url: v.url,
					state: v.upgrade.state,
					tone: v.upgrade.tone,
				},
			})),
			missing: "No request ID",
		};
	},
};
