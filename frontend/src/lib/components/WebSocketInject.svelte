<script>
	import { getToastStore, modeCurrent } from "@skeletonlabs/skeleton";
	import CodeMirror from "svelte-codemirror-editor";
	import { vim } from "@replit/codemirror-vim";
	import { oneDark } from "@codemirror/theme-one-dark";
	import { ayuLight } from "thememirror";
	import { Send } from "lucide-svelte";
	import { InjectWebSocketMessage } from "../wailsjs/go/main/App";
	import { marasiConfig, lineWrap } from "../../stores";
	import {
		connectionStore,
		wsInjectDraft,
	} from "../../stores/connectionStore";

	export let requestId;

	const toastStore = getToastStore();

	let direction = "client";
	let opcode = 1;
	let payloadText = "";
	let appliedDraft = null;
	let injecting = false;
	let error = "";
	const opcodes = [0, 1, 2, 8, 9, 10];

	$: connection = $connectionStore.connectionsByRequestId[requestId];
	$: connectionOpen = connection?.State === "open";

	$: if (
		$wsInjectDraft &&
		$wsInjectDraft.requestId === requestId &&
		$wsInjectDraft !== appliedDraft
	) {
		appliedDraft = $wsInjectDraft;
		direction = $wsInjectDraft.direction || "client";
		opcode = $wsInjectDraft.opcode ?? 1;
		payloadText = $wsInjectDraft.payload || "";
	}

	export function toggleDirection() {
		direction = direction === "client" ? "server" : "client";
	}

	export function cycleOpcode() {
		const index = opcodes.indexOf(Number(opcode));
		opcode = opcodes[(index + 1) % opcodes.length];
	}

	export async function inject() {
		if (injecting || !connectionOpen) return;
		injecting = true;
		error = "";
		try {
			await InjectWebSocketMessage(
				requestId,
				direction,
				Number(opcode),
				payloadText,
			);
			toastStore.trigger({
				message: "WebSocket frame injected",
				background: "variant-filled-success",
			});
		} catch (err) {
			error = String(err);
			toastStore.trigger({
				message: "Unable to inject WebSocket frame",
				background: "variant-filled-error",
			});
		} finally {
			injecting = false;
		}
	}
</script>

<div class="flex h-full min-h-0 w-full flex-col">
	<div
		class="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-surface-500/30 bg-surface-100-800-token px-2 text-xs"
	>
		<div class="flex items-center gap-2">
			<label class="flex items-center gap-1.5 text-xs">
				<span class="opacity-60">Direction</span>
				<select
					class="select select-sm"
					bind:value={direction}
				>
					<option value="client"
						>Client to server</option
					>
					<option value="server"
						>Server to client</option
					>
				</select>
			</label>

			<label class="flex items-center gap-1.5 text-xs">
				<span class="opacity-60">Opcode</span>
				<select
					class="select select-sm"
					bind:value={opcode}
				>
					<option value={0}>Continuation</option>
					<option value={1}>Text</option>
					<option value={2}>Binary</option>
					<option value={8}>Close</option>
					<option value={9}>Ping</option>
					<option value={10}>Pong</option>
				</select>
			</label>
		</div>

		<div class="flex items-center gap-1">
			<span
				class="chip text-xs {connectionOpen
					? 'variant-soft-success'
					: 'variant-soft-error'}"
			>
				{connectionOpen
					? "Connection Open"
					: "Connection Closed"}
			</span>
			<button
				class="btn btn-sm variant-soft-primary"
				disabled={!connectionOpen || injecting}
				on:click={inject}
			>
				<Send size={14} class="mr-1" />
				{injecting ? "Injecting…" : "Inject"}
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

	<div class="min-h-0 flex-1 overflow-auto">
		<CodeMirror
			class="h-full w-full text-xs"
			bind:value={payloadText}
			theme={$modeCurrent ? ayuLight : oneDark}
			extensions={$marasiConfig.VimEnabled ? [vim()] : []}
			lineWrapping={$lineWrap}
		/>
	</div>
</div>
