// The Messages modal's streamed pair kind: the parts of the modal a
// streamed pair supplies (its tabs and their menu actions, and the header).
// The shell is MessagesModal.svelte; the pure parts (tab ids, contexts) are
// MESSAGE_KINDS.stream in kinds.js. Its messages live in streamedPairStore
// only while the modal is open.
import { derived } from "svelte/store";
import {
	ArrowDown,
	ArrowLeftRight,
	Binary,
	Braces,
	ChevronLeft,
	ChevronRight,
	CornerLeftDown,
	FlagIcon,
	Forward,
	Info,
	ListIcon,
	OctagonX,
	SendIcon,
	ToggleLeft,
	Waves,
} from "lucide-svelte";
import { streamTab } from "../keybindings/app.js";
import { canCancel, streamedPairStore } from "../../stores/streamedPairStore.js";
import { checkpointStore, heldOfPair } from "../../stores/checkpointStore";
import { formatSize } from "../websocket/presentation.js";
import { MESSAGE_KINDS } from "./kinds.js";
import StreamCheckpoint from "./StreamCheckpoint.svelte";
import StreamInject from "./StreamInject.svelte";
import StreamMessages from "./StreamMessages.svelte";
import StreamPair from "./StreamPair.svelte";

const base = MESSAGE_KINDS.stream;

// Each tab's icon, component and menu actions. A menu action's `run`
// receives the tab's component instance.
const TABS = {
	messages: {
		icon: ListIcon,
		component: StreamMessages,
		menu: [
			{ actionId: "stream.messages.previous-message", icon: ChevronLeft, run: (tab) => tab.selectPrevious() },
			{ actionId: "stream.messages.next-message", icon: ChevronRight, run: (tab) => tab.selectNext() },
			{ actionId: "stream.messages.jump-to-bottom", icon: ArrowDown, run: (tab) => tab.jumpToBottom() },
			{ actionId: "stream.messages.toggle-message-metadata", icon: Braces, run: (tab) => tab.toggleMetadata() },
			{ actionId: "stream.messages.toggle-raw", icon: Binary, run: (tab) => tab.toggleRaw() },
			{ actionId: "stream.messages.copy-message-to-inject", icon: SendIcon, run: (tab) => tab.copyToInject() },
		],
	},
	checkpoint: {
		icon: FlagIcon,
		component: StreamCheckpoint,
		menu: [
			{ actionId: "stream.checkpoint.toggle-intercept", icon: ToggleLeft, run: (tab) => tab.toggleIntercept() },
			{ actionId: "stream.checkpoint.forward-message", icon: Forward, run: (tab) => tab.forward() },
			{ actionId: "stream.checkpoint.drop-message", icon: CornerLeftDown, run: (tab) => tab.drop() },
		],
	},
	inject: {
		icon: SendIcon,
		component: StreamInject,
		menu: [
			{ actionId: "stream.inject.toggle-direction", icon: ArrowLeftRight, run: (tab) => tab.toggleDirection() },
			{ actionId: "stream.inject.inject-message", icon: SendIcon, run: (tab) => tab.inject() },
		],
	},
	// Read-only: only the shared modal actions.
	pair: { icon: Info, component: StreamPair, menu: [] },
};

const ARROWS = { request: "↑", response: "↓" };

// The header chip while a message arrives: each direction's bytes so far.
function progressChip(progress) {
	const parts = Object.entries(progress ?? {}).map(([direction, p]) => `${ARROWS[direction] ?? ""} ${formatSize(p.Bytes)}`);
	return parts.length ? `receiving ${parts.join(" · ")}` : null;
}

const isLive = (directions) => Object.values(directions ?? {}).some((d) => d && !d.Ending);

export const streamKind = {
	...base,
	tabs: base.tabs.map((tab) => ({ ...tab, ...TABS[tab.id] })),
	tabStore: streamTab,
	previousTabAction: "stream.previous-tab",
	nextTabAction: "stream.next-tab",
	// One open modal's view of its pair. `meta` is { kind: "stream", pairId }.
	session({ meta, toastStore, openTab }) {
		const pairId = meta?.pairId;
		if (pairId) streamedPairStore.open(pairId);
		const view = derived(streamedPairStore, ($s) => $s.pairs[pairId]);

		return {
			header: derived(view, (v) => {
				const pair = v?.pair;
				const count = v?.messages.length ?? 0;
				return {
					icon: Waves,
					iconClass: isLive(v?.directions) ? "text-success-500" : "opacity-60",
					title: pair ? `${pair.Method} ${pair.Host}${pair.Path}` : "Streamed pair",
					count: `${pair ? `#${pair.Number} · ` : ""}${count.toLocaleString()}${v?.hasMore ? "+" : ""} messages`,
					chip: progressChip(v?.progress),
					chipTitle: "A message is still arriving; it appears in Messages once it is whole",
				};
			}),
			// Cancel: no confirmation; offered until both directions have ended.
			action: {
				actionId: "stream.cancel-pair",
				label: "Cancel",
				busyLabel: "Cancelling…",
				icon: OctagonX,
				enabled: derived(view, (v) => Boolean(pairId) && canCancel(v?.directions)),
				async run() {
					const outcome = await streamedPairStore.cancel(pairId);
					if (outcome.ok || outcome.superseded) return;
					toastStore.trigger({
						message: outcome.toast ?? `Unable to cancel: ${outcome.message}`,
						background: "variant-filled-error",
					});
				},
			},
			// The Checkpoint tab's count of the pair's held items.
			tabCounts: derived(checkpointStore, ($cp) => ({ checkpoint: pairId ? heldOfPair($cp, pairId).length : 0 })),
			tabProps: derived(view, () => ({
				messages: pairId && { pairId, onOpenInject: () => openTab("inject") },
				checkpoint: pairId && { pairId },
				inject: pairId && { pairId },
				pair: pairId && { pairId },
			})),
			missing: "No pair",
			destroy: () => pairId && streamedPairStore.close(pairId),
		};
	},
};
