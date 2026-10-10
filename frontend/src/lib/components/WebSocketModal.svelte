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
	import { onDestroy } from "svelte";
	import MarasiKeys from "./MarasiMenu/MarasiKeys.svelte";
	import { useMenuActions, websocketTab } from "../keybindings/app.js";
	import { WEBSOCKET_TABS } from "../keybindings/contexts.js";
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
	};

	useMenuActions([...commonMenu, ...Object.values(tabMenus).flat()]);

	$: openTab = WEBSOCKET_TABS[tabSet];
	$: websocketTab.set(openTab);
	onDestroy(() => websocketTab.set(null));

	$: websocketMenu = [...commonMenu, ...tabMenus[openTab]];

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

<MarasiKeys paletteTier="overlay" menuOptions={websocketMenu} />

{#if $modalStore[0]}
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<div
		class="card p-4 w-[90%] max-w-[95vw] shadow-xl rounded-none flex flex-col max-h-[95vh] border-t-4 border-primary-500 bg-surface-50-800-token text-surface-900-50-token"
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
