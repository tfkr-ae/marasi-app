<script>
	// The WebSocket kind's Stream tab: the shared message table
	// (lib/messages/MessagesTable.svelte) with WebSocket's payload column,
	// row marks, opcode chip, Metadata toggle and Copy to Inject.
	import { getToastStore, modeCurrent } from "@skeletonlabs/skeleton";
	import { primaryVariant } from "../launchpad/format.js";
	import { Braces, Send } from "lucide-svelte";
	import {
		webSocketStore,
		wsInjectDraft,
	} from "../../stores/webSocketStore";
	import { messageRow } from "../websocket/presentation.js";
	import MessagesTable from "../messages/MessagesTable.svelte";
	import WebSocketMessageProperties from "./WebSocketMessageProperties.svelte";

	export let requestId;
	export let onOpenInject = () => {};

	const toastStore = getToastStore();

	let loading = true;
	let error = "";
	let selected = null;
	let view = "frame"; // "frame" | "metadata"
	let table;

	$: messages = $webSocketStore.messagesByRequestId[requestId] || [];
	$: connectionState =
		$webSocketStore.connectionsByRequestId[requestId]?.State || "";

	const opcodeLabel = {
		0: "cont",
		1: "text",
		2: "binary",
		8: "close",
		9: "ping",
		10: "pong",
	};

	function formatMetadata(msg) {
		return JSON.stringify(msg?.Metadata || {}, null, 2);
	}

	function formatPayload(msg, preview = false) {
		if (!msg?.Payload) return "";
		let bytes = msg.Payload;
		if (typeof bytes === "string") {
			try {
				const bin = atob(bytes);
				bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
			} catch {
				return bytes;
			}
		} else if (Array.isArray(bytes)) {
			bytes = Uint8Array.from(bytes);
		}
		if (!(bytes instanceof Uint8Array)) return String(msg.Payload);

		if (msg.Opcode === 8) {
			if (bytes.length < 2) return "close";
			const code = (bytes[0] << 8) | bytes[1];
			const reason = new TextDecoder().decode(bytes.slice(2));
			return reason ? `close ${code}: ${reason}` : `close ${code}`;
		}
		if (msg.Opcode === 2 || msg.IsBinary) {
			const slice = preview ? bytes.slice(0, 32) : bytes;
			const hex = Array.from(slice)
				.map((b) => b.toString(16).padStart(2, "0"))
				.join(" ");
			return preview && bytes.length > 32 ? `${hex} …` : hex;
		}
		const text = new TextDecoder().decode(bytes);
		if (preview && text.length > 80) return text.slice(0, 80) + "…";
		return text;
	}

	function formatTime(value) {
		if (!value) return "";
		return new Date(value).toLocaleTimeString(undefined, {
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false,
		});
	}

	function rowClass(msg) {
		const closeMessage = msg.Opcode === 8 ? "!bg-primary-500/10" : "";
		const dropped = msg.Metadata?.dropped
			? "line-through decoration-error-500/70"
			: "";
		return `${closeMessage} ${dropped} ${messageRow(msg).edgeClass}`;
	}

	const columns = [
		{
			id: "payload",
			header: "Payload",
			cell: (msg) => formatPayload(msg, true),
		},
	];

	export function selectPreviousFrame() {
		table?.selectPrevious();
	}

	export function selectNextFrame() {
		table?.selectNext();
	}

	export function jumpToBottom() {
		table?.jumpToBottom();
	}

	export function toggleView() {
		if (!selected) return;
		view = view === "frame" ? "metadata" : "frame";
	}

	export function copyToInject() {
		if (!selected) return;
		wsInjectDraft.set({
			requestId,
			direction: selected.Direction || "client",
			opcode: selected.Opcode ?? 1,
			payload: formatPayload(selected),
		});
		onOpenInject();
		toastStore.trigger({
			message: "Copied to Inject",
			background: "variant-filled-success",
		});
	}

	async function load() {
		if (!requestId) return;
		loading = true;
		error = "";
		try {
			await webSocketStore.populate(requestId);
		} catch (err) {
			error = String(err);
		} finally {
			loading = false;
		}
	}

	$: if (requestId) load();
</script>

<MessagesTable
	bind:this={table}
	bind:selected
	{view}
	{messages}
	{loading}
	{error}
	{columns}
	{rowClass}
	sourceKey={requestId}
	isOutgoing={(msg) => msg.Direction === "client"}
	rowTitle={(msg) => messageRow(msg).tooltip}
	isInjected={(msg) => Boolean(msg.Metadata?.injected)}
	detailText={(msg, shown) => (shown === "metadata" ? formatMetadata(msg) : formatPayload(msg))}
>
	<svelte:fragment slot="summary" let:selected={message}>
		<span class="chip variant-soft-surface text-xs">
			{opcodeLabel[message.Opcode] ?? message.Opcode}
		</span>
		<span class="whitespace-nowrap">{formatTime(message.CreatedAt)}</span>
		<span class="opacity-60">{message.Direction}</span>
	</svelte:fragment>
	<svelte:fragment slot="status">
		{#if connectionState === "closed"}
			<span class="chip variant-soft-error text-xs">Connection Closed</span>
		{/if}
	</svelte:fragment>
	<svelte:fragment slot="actions">
		<button
			class="btn btn-sm {primaryVariant($modeCurrent)}"
			disabled={!selected}
			on:click={toggleView}
		>
			<Braces size={14} class="mr-1" />
			{view === "metadata" ? "View Message" : "Metadata"}
		</button>
		<button
			class="btn btn-sm {primaryVariant($modeCurrent)}"
			disabled={!selected}
			on:click={copyToInject}
		>
			<Send size={14} class="mr-1" /> Copy to Inject
		</button>
	</svelte:fragment>
	<svelte:fragment slot="properties" let:selected={message}>
		<WebSocketMessageProperties {message} />
	</svelte:fragment>
</MessagesTable>
