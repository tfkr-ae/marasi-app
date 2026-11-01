<script>
	import {
		getModalStore,
		getToastStore,
		TabGroup,
		Tab,
	} from "@skeletonlabs/skeleton";
	import {
		ArrowLeftRight,
		ArrowDown,
		Braces,
		ChevronLeft,
		ChevronRight,
		CornerLeftDown,
		FlagIcon,
		Forward,
		Info,
		Loader,
		RadioIcon,
		RotateCw,
		SendIcon,
		ToggleLeft,
		Unplug,
		XIcon,
	} from "lucide-svelte";
	import { onDestroy } from "svelte";
	import MarasiKeys from "./MarasiMenu/MarasiKeys.svelte";
	import { useMenuActions, websocketTab } from "../keybindings/app.js";
	import { stepWebSocketTab } from "../keybindings/contexts.js";
	import WebSocketCheckpoint from "./WebSocketCheckpoint.svelte";
	import WebSocketConnection from "./WebSocketConnection.svelte";
	import WebSocketInject from "./WebSocketInject.svelte";
	import WebSocketMessagesTable from "./WebSocketMessagesTable.svelte";
	import { connectionStore } from "../../stores/connectionStore";
	import { CloseWebSocket } from "../wailsjs/go/main/App";
	import { upgradeFromRequest, upgradePresentation } from "../websocket/presentation.js";
	import { progressChip } from "../websocket/progress.js";

	const modalStore = getModalStore();
	const toastStore = getToastStore();
	// The open tab, by its name in WEBSOCKET_TABS.
	let openTab = "stream";
	let closing = false;
	let messagesTable;
	let checkpoint;
	let injectEditor;

	function stepTab(step) {
		openTab = stepWebSocketTab(openTab, step);
	}

	function previousTab() {
		stepTab(-1);
	}

	function nextTab() {
		stepTab(1);
	}

	// Menu actions by context; labels and keys come from the catalog. All
	// handlers stay registered while the modal is open, and the open tab
	// (published as websocketTab) decides which tab actions a key reaches.
	const commonMenu = [
		{
			actionId: "websocket.previous-tab",
			icon: ChevronLeft,
			handler: previousTab,
		},
		{
			actionId: "websocket.next-tab",
			icon: ChevronRight,
			handler: nextTab,
		},
		{
			actionId: "websocket.close-connection",
			icon: Unplug,
			handler: closeConnection,
		},
	];

	const tabMenus = {
		stream: [
			{
				actionId: "websocket.stream.previous-frame",
				icon: ChevronLeft,
				handler: () => messagesTable?.selectPreviousFrame(),
			},
			{
				actionId: "websocket.stream.next-frame",
				icon: ChevronRight,
				handler: () => messagesTable?.selectNextFrame(),
			},
			{
				actionId: "websocket.stream.jump-to-bottom",
				icon: ArrowDown,
				handler: () => messagesTable?.jumpToBottom(),
			},
			{
				actionId: "websocket.stream.toggle-frame-metadata",
				icon: Braces,
				handler: () => messagesTable?.toggleView(),
			},
			{
				actionId: "websocket.stream.copy-frame-to-inject",
				icon: SendIcon,
				handler: () => messagesTable?.copyToInject(),
			},
		],
		checkpoint: [
			{
				actionId: "websocket.checkpoint.toggle-intercept",
				icon: ToggleLeft,
				handler: () => checkpoint?.toggleIntercept(),
			},
			{
				actionId: "websocket.checkpoint.forward-frame",
				icon: Forward,
				handler: () => checkpoint?.forward(),
			},
			{
				actionId: "websocket.checkpoint.drop-frame",
				icon: CornerLeftDown,
				handler: () => checkpoint?.drop(),
			},
		],
		inject: [
			{
				actionId: "websocket.inject.toggle-direction",
				icon: ArrowLeftRight,
				handler: () => injectEditor?.toggleDirection(),
			},
			{
				actionId: "websocket.inject.cycle-opcode",
				icon: RotateCw,
				handler: () => injectEditor?.cycleOpcode(),
			},
			{
				actionId: "websocket.inject.inject-frame",
				icon: SendIcon,
				handler: () => injectEditor?.inject(),
			},
		],
		// Read-only: only the shared modal actions.
		connection: [],
	};

	useMenuActions([...commonMenu, ...Object.values(tabMenus).flat()]);

	$: websocketTab.set(openTab);
	onDestroy(() => websocketTab.set(null));

	$: websocketMenu = [...commonMenu, ...tabMenus[openTab]];

	$: request = $modalStore[0]?.meta?.upgradeRequest;
	$: requestId =
		request?.Request?.ID ||
		request?.ID ||
		$modalStore[0]?.meta?.requestId;
	$: upgrade = upgradePresentation(
		upgradeFromRequest(
			request,
			$connectionStore.connectionsByRequestId[requestId]?.State,
		),
	);
	$: messageCount = ($connectionStore.messagesByRequestId[requestId] || [])
		.length;
	$: transport =
		request?.Metadata?.["websocket.transport"] ||
		$connectionStore.connectionsByRequestId[requestId]?.Transport ||
		"ws";
	$: host =
		request?.Request?.Host ||
		$connectionStore.connectionsByRequestId[requestId]?.Host ||
		"";
	$: path =
		request?.Request?.Path ||
		$connectionStore.connectionsByRequestId[requestId]?.Path ||
		"";
	$: progress = $connectionStore.progressByRequestId[requestId];
	$: chip = progress ? progressChip(progress) : null;

	async function closeConnection() {
		if (!requestId || upgrade.state !== "open" || closing) return;
		closing = true;
		try {
			await CloseWebSocket(requestId, 1000, "");
			toastStore.trigger({
				message: "WebSocket connection closed",
				background: "variant-filled-success",
			});
		} catch (error) {
			toastStore.trigger({
				message: `Unable to close WebSocket connection: ${error}`,
				background: "variant-filled-error",
			});
		} finally {
			closing = false;
		}
	}
</script>

<MarasiKeys paletteTier="overlay" menuOptions={websocketMenu} />

{#if $modalStore[0]}
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<div
		class="card p-4 text-sm w-[90%] max-w-[95vw] shadow-xl rounded-none flex flex-col max-h-[95vh] border-t-4 border-primary-500 bg-surface-50-800-token text-surface-900-50-token"
		on:keydown={(event) => {
			if (event.key === "Escape") {
				event.stopImmediatePropagation();
				modalStore.close();
			}
		}}
	>
		<header class="flex justify-between items-center gap-3">
			<div class="flex min-w-0 items-center gap-2">
				<RadioIcon size={18} class={upgrade.iconClass} />
				<h2 class="truncate text-base font-bold">
					{transport}://{host}{path}
				</h2>
				<span class="shrink-0 text-sm opacity-70"
					>{messageCount} messages</span
				>
				{#if chip}
					<span
						class="chip variant-soft-primary shrink-0 text-xs"
						title="A message is still arriving; it appears in Stream once its last frame is in"
					>
						<Loader size={12} class="animate-spin" />
						{chip.arrow}
						{chip.label}
					</span>
				{/if}
			</div>

			<div class="flex items-center gap-2">
				<button
					class="btn btn-sm variant-soft-error"
					disabled={upgrade.state !== "open" || closing}
					on:click={closeConnection}
				>
					<Unplug size={14} class="mr-1" />
					{closing
						? "Closing…"
						: "Close Connection"}
				</button>
				<button
					class="text-2xl leading-none"
					aria-label="Close modal"
					on:click={modalStore.close}
				>
					<XIcon size={16} />
				</button>
			</div>
		</header>

		<div class="mt-2 flex w-full justify-center">
			<TabGroup padding="px-3 py-1" regionList="text-sm">
				<Tab
					bind:group={openTab}
					name="stream"
					value="stream"
				>
					<div class="flex items-center gap-2">
						<RadioIcon size={14} />
						<span>Stream</span>
					</div>
				</Tab>
				<Tab
					bind:group={openTab}
					name="checkpoint"
					value="checkpoint"
				>
					<div class="flex items-center gap-2">
						<FlagIcon size={14} />
						<span>Checkpoint</span>
					</div>
				</Tab>
				<Tab
					bind:group={openTab}
					name="inject"
					value="inject"
				>
					<div class="flex items-center gap-2">
						<SendIcon size={14} />
						<span>Inject</span>
					</div>
				</Tab>
				<Tab
					bind:group={openTab}
					name="connection"
					value="connection"
				>
					<div class="flex items-center gap-2">
						<Info size={14} />
						<span>Connection</span>
					</div>
				</Tab>
			</TabGroup>
		</div>

		<div class="mt-2 flex min-h-0 w-full flex-1 flex-col">
			{#if openTab === "stream"}
				<div
					class="h-[70vh] w-full min-w-0 overflow-hidden"
				>
					{#if requestId}
						<WebSocketMessagesTable
							bind:this={messagesTable}
							{requestId}
							onOpenInject={() => {
								openTab = "inject";
							}}
						/>
					{:else}
						<div
							class="p-4 text-xs opacity-60"
						>
							No request ID
						</div>
					{/if}
				</div>
			{:else if openTab === "checkpoint"}
				<div
					class="h-[70vh] w-full min-w-0 overflow-hidden"
				>
					{#if requestId}
						<WebSocketCheckpoint
							bind:this={checkpoint}
							{requestId}
						/>
					{:else}
						<div
							class="p-4 text-xs opacity-60"
						>
							No request ID
						</div>
					{/if}
				</div>
			{:else if openTab === "inject"}
				<div
					class="h-[70vh] w-full min-w-0 overflow-hidden"
				>
					{#if requestId}
						<WebSocketInject
							bind:this={injectEditor}
							{requestId}
						/>
					{:else}
						<div
							class="p-4 text-xs opacity-60"
						>
							No request ID
						</div>
					{/if}
				</div>
			{:else if openTab === "connection"}
				<div
					class="h-[70vh] w-full min-w-0 overflow-hidden"
				>
					<WebSocketConnection
						{requestId}
						{request}
						url="{transport}://{host}{path}"
						state={upgrade.state}
						tone={upgrade.tone}
					/>
				</div>
			{/if}
		</div>
	</div>
{/if}
