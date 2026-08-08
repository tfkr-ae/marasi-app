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
		RadioIcon,
		RotateCw,
		SendIcon,
		ToggleLeft,
		Unplug,
		XIcon,
	} from "lucide-svelte";
	import MarasiKeys from "./MarasiMenu/MarasiKeys.svelte";
	import WebSocketCheckpoint from "./WebSocketCheckpoint.svelte";
	import WebSocketInject from "./WebSocketInject.svelte";
	import WebSocketMessagesTable from "./WebSocketMessagesTable.svelte";
	import { connectionStore } from "../../stores/connectionStore";
	import { CloseWebSocket } from "../wailsjs/go/main/App";

	const modalStore = getModalStore();
	const toastStore = getToastStore();
	let tabSet = 0;
	let closing = false;
	let messagesTable;
	let checkpoint;
	let injectEditor;

	function previousTab() {
		tabSet = (tabSet + 2) % 3;
	}

	function nextTab() {
		tabSet = (tabSet + 1) % 3;
	}

	const commonMenu = [
		{
			name: "Previous WebSocket Tab",
			subtitle: "Move to the previous WebSocket tab",
			keywords: "websocket previous tab stream checkpoint inject",
			icon: ChevronLeft,
			action: {
				handler: previousTab,
				options: { scope: "websocket", single: true },
				keys: ["⌘+[", "ctrl+["],
			},
		},
		{
			name: "Next WebSocket Tab",
			subtitle: "Move to the next WebSocket tab",
			keywords: "websocket next tab stream checkpoint inject",
			icon: ChevronRight,
			action: {
				handler: nextTab,
				options: { scope: "websocket", single: true },
				keys: ["⌘+]", "ctrl+]"],
			},
		},
		{
			name: "Close WebSocket Connection",
			subtitle: "Close the active WebSocket connection",
			keywords: "websocket close disconnect",
			icon: Unplug,
			action: {
				handler: closeConnection,
				options: { scope: "websocket", single: true },
				keys: ["⌘+⇧+X", "ctrl+⇧+X"],
			},
		},
	];

	const streamMenu = [
		{
			name: "Previous WebSocket Frame",
			subtitle: "Select the previous frame in the stream",
			keywords: "websocket previous frame message",
			icon: ChevronLeft,
			action: {
				handler: () => messagesTable?.selectPreviousFrame(),
				options: { scope: "websocket", single: true },
				keys: ["⌘+⇧+[", "ctrl+⇧+["],
			},
		},
		{
			name: "Next WebSocket Frame",
			subtitle: "Select the next frame in the stream",
			keywords: "websocket next frame message",
			icon: ChevronRight,
			action: {
				handler: () => messagesTable?.selectNextFrame(),
				options: { scope: "websocket", single: true },
				keys: ["⌘+⇧+]", "ctrl+⇧+]"],
			},
		},
		{
			name: "Jump to Bottom",
			subtitle: "Jump to the newest frame and resume auto-scroll",
			keywords: "websocket stream bottom newest follow auto-scroll",
			icon: ArrowDown,
			action: {
				handler: () => messagesTable?.jumpToBottom(),
				options: { scope: "websocket", single: true },
				keys: ["⌘+⇧+down", "ctrl+⇧+down"],
			},
		},
		{
			name: "Toggle Frame Metadata",
			subtitle: "Switch between the frame payload and metadata",
			keywords: "websocket frame metadata payload",
			icon: Braces,
			action: {
				handler: () => messagesTable?.toggleView(),
				options: { scope: "websocket", single: true },
				keys: ["⌘+⇧+M", "ctrl+⇧+M"],
			},
		},
		{
			name: "Copy Frame to Inject",
			subtitle: "Copy the selected frame into the Inject tab",
			keywords: "websocket frame copy inject",
			icon: SendIcon,
			action: {
				handler: () => messagesTable?.copyToInject(),
				options: { scope: "websocket", single: true },
				keys: ["⌘+⇧+I", "ctrl+⇧+I"],
			},
		},
	];

	const checkpointMenu = [
		{
			name: "Toggle WebSocket Intercept",
			subtitle: "Enable or disable WebSocket interception",
			keywords: "websocket checkpoint intercept toggle",
			icon: ToggleLeft,
			action: {
				handler: () => checkpoint?.toggleIntercept(),
				options: { scope: "websocket", single: true },
				keys: ["⌘+⇧+I", "ctrl+⇧+I"],
			},
		},
		{
			name: "Forward WebSocket Frame",
			subtitle: "Forward the current intercepted frame",
			keywords: "websocket checkpoint forward frame",
			icon: Forward,
			action: {
				handler: () => checkpoint?.forward(),
				options: { scope: "websocket", single: true },
				keys: ["⌘+⇧+F", "ctrl+⇧+F"],
			},
		},
		{
			name: "Drop WebSocket Frame",
			subtitle: "Drop the current intercepted frame",
			keywords: "websocket checkpoint drop frame",
			icon: CornerLeftDown,
			action: {
				handler: () => checkpoint?.drop(),
				options: { scope: "websocket", single: true },
				keys: ["⌘+⇧+D", "ctrl+⇧+D"],
			},
		},
	];

	const injectMenu = [
		{
			name: "Toggle Inject Direction",
			subtitle: "Switch the injected frame direction",
			keywords: "websocket inject direction client server",
			icon: ArrowLeftRight,
			action: {
				handler: () => injectEditor?.toggleDirection(),
				options: { scope: "websocket", single: true },
				keys: ["⌘+⇧+D", "ctrl+⇧+D"],
			},
		},
		{
			name: "Cycle Inject Opcode",
			subtitle: "Select the next WebSocket opcode",
			keywords: "websocket inject opcode cycle",
			icon: RotateCw,
			action: {
				handler: () => injectEditor?.cycleOpcode(),
				options: { scope: "websocket", single: true },
				keys: ["⌘+⇧+O", "ctrl+⇧+O"],
			},
		},
		{
			name: "Inject WebSocket Frame",
			subtitle: "Inject the current message into the connection",
			keywords: "websocket inject send frame message",
			icon: SendIcon,
			action: {
				handler: () => injectEditor?.inject(),
				options: { scope: "websocket", single: true },
				keys: ["⌘+⇧+↩", "ctrl+⇧+enter"],
			},
		},
	];

	$: websocketMenu = [
		...commonMenu,
		...(tabSet === 0
			? streamMenu
			: tabSet === 1
				? checkpointMenu
				: injectMenu),
	];

	$: request = $modalStore[0]?.meta?.upgradeRequest;
	$: requestId =
		request?.Request?.ID ||
		request?.ID ||
		$modalStore[0]?.meta?.requestId;
	$: isWebSocket =
		request?.Metadata?.protocol === "websocket" ||
		request?.Response?.StatusCode === 101 ||
		request?.Response?.ContentType === "websocket";
	$: wsState =
		$connectionStore.connectionsByRequestId[requestId]?.State ||
		request?.Metadata?.["websocket.state"] ||
		"";
	$: wsColor =
		wsState === "open"
			? "text-success-500"
			: wsState === "pending"
				? "text-warning-500"
				: isWebSocket
					? "text-error-500"
					: "";
	$: frameCount = ($connectionStore.messagesByRequestId[requestId] || [])
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

	async function closeConnection() {
		if (!requestId || wsState !== "open" || closing) return;
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

<MarasiKeys scope="websocket" menuOptions={websocketMenu} />

{#if $modalStore[0]}
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<div
		class="card p-4 w-[90%] max-w-[95vw] shadow-xl rounded-none flex flex-col max-h-[95vh] border-t-4 border-primary-500"
		on:keydown={(event) => {
			if (event.key === "Escape") {
				event.stopImmediatePropagation();
				modalStore.close();
			}
		}}
	>
		<header class="flex justify-between items-center gap-3">
			<div class="flex min-w-0 items-center gap-2">
				<RadioIcon size={24} class={wsColor} />
				<h2 class="truncate text-base">
					{transport}://{host}{path}
				</h2>
				<span class="shrink-0 text-sm opacity-70"
					>{frameCount} frames</span
				>
			</div>

			<div class="flex items-center gap-2">
				<button
					class="btn btn-sm variant-soft-error"
					disabled={wsState !== "open" || closing}
					on:click={closeConnection}
				>
					<Unplug size={16} class="mr-1" />
					{closing
						? "Closing…"
						: "Close Connection"}
				</button>
				<button
					class="text-2xl leading-none"
					aria-label="Close modal"
					on:click={modalStore.close}
				>
					<XIcon />
				</button>
			</div>
		</header>

		<div class="mt-2 flex w-full justify-center">
			<TabGroup>
				<Tab
					bind:group={tabSet}
					name="stream"
					value={0}
				>
					<div class="flex items-center gap-2">
						<RadioIcon size={16} />
						<span>Stream</span>
					</div>
				</Tab>
				<Tab
					bind:group={tabSet}
					name="checkpoint"
					value={1}
				>
					<div class="flex items-center gap-2">
						<FlagIcon size={16} />
						<span>Checkpoint</span>
					</div>
				</Tab>
				<Tab
					bind:group={tabSet}
					name="inject"
					value={2}
				>
					<div class="flex items-center gap-2">
						<SendIcon size={16} />
						<span>Inject</span>
					</div>
				</Tab>
			</TabGroup>
		</div>

		<div class="mt-2 flex min-h-0 w-full flex-1 flex-col">
			{#if tabSet === 0}
				<div
					class="h-[70vh] w-full min-w-0 overflow-hidden"
				>
					{#if requestId}
						<WebSocketMessagesTable
							bind:this={messagesTable}
							{requestId}
							onOpenInject={() => {
								tabSet = 2;
							}}
						/>
					{:else}
						<div
							class="p-4 text-sm opacity-60"
						>
							No request ID
						</div>
					{/if}
				</div>
			{:else if tabSet === 1}
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
							class="p-4 text-sm opacity-60"
						>
							No request ID
						</div>
					{/if}
				</div>
			{:else if tabSet === 2}
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
							class="p-4 text-sm opacity-60"
						>
							No request ID
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>
{/if}
