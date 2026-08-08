<script>
	import { onMount } from "svelte";
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import CodeMirror from "svelte-codemirror-editor";
	import { vim } from "@replit/codemirror-vim";
	import { oneDark } from "@codemirror/theme-one-dark";
	import { ayuLight } from "thememirror";
	import {
		ArrowDownLeft,
		ArrowUpRight,
		CornerLeftDown,
		Forward,
		ToggleLeft,
		ToggleRight,
	} from "lucide-svelte";
	import { marasiConfig, lineWrap } from "../../stores";
	import { connectionStore } from "../../stores/connectionStore";

	export let requestId;

	let payloadText = "";
	let editorMessageId = null;

	$: queue = $connectionStore.interceptionsByRequestId[requestId] || [];
	$: intercepted = queue[0] || null;
	$: loading =
		$connectionStore.interceptionLoadingByRequestId[requestId] || false;
	$: processing =
		$connectionStore.interceptionProcessingByRequestId[requestId] || false;
	$: error =
		$connectionStore.interceptionErrorsByRequestId[requestId] || "";
	$: interceptEnabled = $connectionStore.wsInterceptEnabled;

	const opcodeLabel = {
		0: "continuation",
		1: "text",
		2: "binary",
		8: "close",
		9: "ping",
		10: "pong",
	};

	function decodePayload(payload) {
		if (!payload) return "";
		let bytes = payload;
		if (typeof bytes === "string") {
			try {
				const binary = atob(bytes);
				bytes = Uint8Array.from(binary, (char) =>
					char.charCodeAt(0),
				);
			} catch {
				return bytes;
			}
		} else if (Array.isArray(bytes)) {
			bytes = Uint8Array.from(bytes);
		}
		return bytes instanceof Uint8Array
			? new TextDecoder().decode(bytes)
			: String(payload);
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

	export function toggleIntercept() {
		if (!processing) connectionStore.toggleIntercept();
	}

	export function forward() {
		if (intercepted && !processing) {
			connectionStore.forwardInterception(requestId, payloadText);
		}
	}

	export function drop() {
		if (intercepted && !processing) {
			connectionStore.dropInterception(requestId);
		}
	}

	onMount(() => {
		connectionStore.populateInterception(requestId);
	});

	$: if ((intercepted?.ID ?? null) !== editorMessageId) {
		editorMessageId = intercepted?.ID ?? null;
		payloadText = intercepted ? decodePayload(intercepted.Payload) : "";
	}
</script>

<div class="flex h-full min-h-0 w-full flex-col">
	<div
		class="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-surface-500/30 bg-surface-100-800-token px-2 text-xs"
	>
		<span class="chip variant-soft-surface text-xs">
			{queue.length === 1
				? "1 frame queued"
				: queue.length > 1
					? `${queue.length} frames queued`
					: "Queue empty"}
		</span>

		<div class="flex shrink-0 items-center gap-1">
			<button
				class="btn btn-sm variant-soft-primary"
				disabled={!intercepted || processing}
				on:click={forward}
			>
				<Forward size={14} class="mr-1" /> Forward
			</button>
			<button
				class="btn btn-sm !border-0 !ring-0 focus:!outline-none {interceptEnabled
					? 'variant-soft-success hover:variant-soft-success'
					: 'variant-soft-primary'}"
				disabled={processing}
				on:click={toggleIntercept}
			>
				{#if interceptEnabled}
					<ToggleRight size={14} class="mr-1" />
				{:else}
					<ToggleLeft size={14} class="mr-1" />
				{/if}
				Intercept {interceptEnabled ? "On" : "Off"}
			</button>
			<button
				class="btn btn-sm variant-soft-primary"
				disabled={!intercepted || processing}
				on:click={drop}
			>
				<CornerLeftDown size={14} class="mr-1" /> Drop
			</button>
		</div>
	</div>

	{#if error}
		<div
			class="shrink-0 border-b border-error-500/30 bg-error-500/10 px-3 py-1.5 text-xs text-error-500"
		>
			{error}
		</div>
	{/if}

	{#if intercepted}
		<div
			class="flex h-10 shrink-0 items-center gap-3 border-b border-surface-500/30 px-3 font-mono text-xs"
		>
			<span class="inline-flex items-center gap-1.5">
				{#if intercepted.Direction === "client"}
					<ArrowUpRight size={15} class="text-primary-500" />
					Client to server
				{:else}
					<ArrowDownLeft size={15} class="text-secondary-500" />
					Server to client
				{/if}
			</span>
			<span class="chip variant-soft-surface text-xs">
				{opcodeLabel[intercepted.Opcode] ?? intercepted.Opcode}
			</span>
			<span class="opacity-60">{formatTime(intercepted.CreatedAt)}</span>
		</div>

		<div class="min-h-0 flex-1 overflow-auto">
			<CodeMirror
				class="h-full w-full text-xs"
				bind:value={payloadText}
				theme={$modeCurrent ? ayuLight : oneDark}
				extensions={$marasiConfig.VimEnabled ? [vim()] : []}
				lineWrapping={$lineWrap}
			/>
		</div>
	{:else if loading}
		<div class="flex min-h-0 flex-1 items-center justify-center text-sm opacity-60">
			Loading interception queue…
		</div>
	{:else}
		<div class="flex min-h-0 flex-1 items-center justify-center text-sm opacity-60">
			No WebSocket frames in the interception queue
		</div>
	{/if}
</div>
