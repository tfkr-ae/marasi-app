<script>
	import { getToastStore, modeCurrent } from "@skeletonlabs/skeleton";
	import CodeMirror from "svelte-codemirror-editor";
	import { vim } from "@replit/codemirror-vim";
	import { oneDark } from "@codemirror/theme-one-dark";
	import { githubLight } from "@uiw/codemirror-theme-github";
	import { Send } from "lucide-svelte";
	import { InjectWebSocketMessage } from "../wailsjs/go/main/App";
	import { marasiConfig, lineWrap } from "../../stores";
	import { longStrings } from "../longStrings.js";
	import {
		connectionStore,
		wsInjectDraft,
	} from "../../stores/connectionStore";
	import {
		INJECT_OPCODES,
		draftOpcode,
		nextInjectOpcode,
		offersSendUncompressed,
	} from "../websocket/inject.js";

	export let requestId;

	const toastStore = getToastStore();

	let direction = "client";
	let opcode = 1;
	let payloadText = "";
	let appliedDraft = null;
	let injecting = false;
	let error = "";
	let neverCompress = false;

	$: connection = $connectionStore.connectionsByRequestId[requestId];
	$: connectionOpen = connection?.State === "open";
	$: showSendUncompressed = offersSendUncompressed(connection, opcode);

	$: if (
		$wsInjectDraft &&
		$wsInjectDraft.requestId === requestId &&
		$wsInjectDraft !== appliedDraft
	) {
		appliedDraft = $wsInjectDraft;
		direction = $wsInjectDraft.direction || "client";
		opcode = draftOpcode($wsInjectDraft.opcode);
		payloadText = $wsInjectDraft.payload || "";
	}

	export function toggleDirection() {
		direction = direction === "client" ? "server" : "client";
	}

	export function cycleOpcode() {
		opcode = nextInjectOpcode(opcode);
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
				showSendUncompressed && neverCompress,
			);
			toastStore.trigger({
				message: "WebSocket message injected",
				background: "variant-filled-success",
			});
		} catch (err) {
			error = String(err);
			toastStore.trigger({
				message: "Unable to inject WebSocket message",
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
					class="select select-sm bg-white dark:bg-surface-700 border-0 ring-0 focus:border-0 focus:ring-0"
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
					class="select select-sm bg-white dark:bg-surface-700 border-0 ring-0 focus:border-0 focus:ring-0"
					bind:value={opcode}
				>
					{#each INJECT_OPCODES as { value, label }}
						<option {value}>{label}</option>
					{/each}
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

	{#if showSendUncompressed}
		<label
			class="flex shrink-0 items-center gap-2 border-b border-surface-500/30 px-3 py-1.5 text-xs"
		>
			<input
				type="checkbox"
				class="checkbox"
				bind:checked={neverCompress}
			/>
			Send uncompressed
			<span class="opacity-60"
				>— this connection uses permessage-deflate; by default
				Marasi compresses injected messages like the peer would.</span
			>
		</label>
	{/if}

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
			theme={$modeCurrent ? githubLight : oneDark}
			extensions={[...($marasiConfig.VimEnabled ? [vim()] : []), longStrings({ wrap: $lineWrap, mode: $marasiConfig.WrapMode })]}
		/>
	</div>
</div>
