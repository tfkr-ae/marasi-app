<script>
	// The selected intercepted item: a top bar with its title and actions,
	// then the request | response split. The intercepted side is editable and
	// marked; the other side is context: "Not sent yet" for a held request,
	// the stored request a held response answers, or a WebSocket message's
	// connection. Confirmations and toasts belong to the page.
	import CodeMirror from "svelte-codemirror-editor";
	import { StreamLanguage } from "@codemirror/language";
	import { http } from "@codemirror/legacy-modes/mode/http";
	import { oneDark } from "@codemirror/theme-one-dark";
	import { githubLight } from "@uiw/codemirror-theme-github";
	import { vim } from "@replit/codemirror-vim";
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import { CornerDownRight, Forward, X } from "lucide-svelte";
	import { lineWrap, marasiConfig } from "../../stores";
	import { isDirty, parseErrorOf, textOf } from "../../stores/checkpointStore";
	import { WRAP_SUSPENDED } from "../lineWrap.js";
	import { longStrings } from "../longStrings.js";
	import { usesSyntax } from "../ledger/drawer.js";
	import { primaryVariant, statusClass } from "../launchpad/format.js";
	import { interceptedFor, itemTitle } from "./items.js";

	export let store;
	/** { item, summary, launch, context } for the selected item. */
	export let entry;
	export let index = 0;
	export let total = 0;
	export let now = Date.now();
	export let onForward = (id, options) => {};
	export let onDrop = (id) => {};

	$: state = $store;
	$: item = entry.item;
	$: summary = entry.summary;
	$: request = entry.context?.request;
	$: connection = entry.context?.connection;
	$: text = textOf(state, item.ID);
	$: dirty = isDirty(state, item.ID);
	$: error = parseErrorOf(state, item.ID);
	$: primary = primaryVariant($modeCurrent);
	$: theme = $modeCurrent ? githubLight : oneDark;
	$: vimExtensions = $marasiConfig.VimEnabled ? [vim()] : [];
	let paused = false;
	let contextPaused = false;
	$: editExtensions = [
		...vimExtensions,
		longStrings({ wrap: $lineWrap, mode: $marasiConfig.WrapMode, onSuspend: (on) => (paused = on) }),
	];
	$: contextExtensions = [
		longStrings({ wrap: $lineWrap, mode: $marasiConfig.WrapMode, onSuspend: (on) => (contextPaused = on) }),
	];
	const lang = (body) => (usesSyntax(body, $marasiConfig.SyntaxMode) ? StreamLanguage.define(http) : undefined);

	const OPCODES = { 0: "continuation", 1: "text", 2: "binary", 8: "close", 9: "ping", 10: "pong" };
	$: heldLeft = item.Type === "request";
	const head =
		"flex items-center justify-between border-b border-surface-500/30 bg-surface-50 px-3 py-1 text-xs dark:bg-surface-900";
	const heldHead = "!bg-primary-500/10 shadow-[inset_3px_0_0_rgb(var(--color-primary-500))]";
	const chip = "cp-chip ml-1 rounded bg-primary-500 px-1 py-px text-[10px] font-bold uppercase text-white";

	let editor;
	/** Focuses the intercepted pane's editor. */
	export function focusEditor() {
		editor?.focus();
	}
	const revert = () => store.edit(item.ID, item.text);
	const edit = (event) => store.edit(item.ID, event.detail);
</script>

<div class="flex h-full min-h-0 flex-col">
	<header class="flex items-center gap-3 border-b border-surface-500/30 bg-surface-50 px-3 py-2 dark:bg-surface-900">
		<div class="min-w-0 flex-1">
			<h2 class="cp-title truncate font-mono text-sm font-bold">{itemTitle(summary, request?.Number)}</h2>
			<p class="cp-meta truncate text-[11px] opacity-60">
				{summary.host || "Unknown host"} · intercepted {interceptedFor(item.InterceptedAt, now) || "now"} ago · item {index + 1} of {total}
				{#if entry.launch} · from Launchpad · {entry.launch}{/if}
			</p>
		</div>
		<div class="flex flex-none items-center gap-2">
			<button class="cp-forward btn btn-sm {primary}" disabled={!!error} title="Forward" on:click={() => onForward(item.ID)}>
				<Forward size={14} class="mr-1" />Forward
			</button>
			{#if item.Type === "request"}
				<button
					class="cp-forward-intercept btn btn-sm {primary}"
					disabled={!!error}
					title="Forward and intercept its response"
					on:click={() => onForward(item.ID, { interceptResponse: true })}
				>
					<CornerDownRight size={14} class="mr-1" />Forward + intercept response
				</button>
			{/if}
			<button class="cp-drop btn btn-sm {primary}" title="Drop" on:click={() => onDrop(item.ID)}>
				<X size={14} class="mr-1" />Drop
			</button>
		</div>
	</header>

	{#key item.Type + item.ID}
		<div class="grid min-h-0 flex-1 grid-cols-2">
			<!-- Left: the request, or a WebSocket message's connection. -->
			<section class="flex min-h-0 min-w-0 flex-col border-r border-surface-500/30">
				{#if item.Type === "websocket"}
					<div class={head}><span class="font-bold">Connection</span></div>
					<dl class="cp-connection grid grid-cols-[6rem_1fr] gap-y-1 p-3 font-mono text-[11px]">
						<dt class="opacity-60">Host</dt>
						<dd class="truncate">{connection?.Host ?? "…"}</dd>
						<dt class="opacity-60">Path</dt>
						<dd class="truncate">{connection?.Path ?? "…"}</dd>
						<dt class="opacity-60">Direction</dt>
						<dd>{item.Direction === "client" ? "Client → server" : "Server → client"}</dd>
						<dt class="opacity-60">Opcode</dt>
						<dd>{item.Opcode}{OPCODES[item.Opcode] ? ` · ${OPCODES[item.Opcode]}` : ""}</dd>
					</dl>
				{:else}
					<div class="{head} {heldLeft ? heldHead : ''}">
						<span class="font-bold">
							Request
							{#if heldLeft}<span class={chip}>Intercepted</span>{:else}<span class="font-normal opacity-60">· sent</span>{/if}
							{#if heldLeft && dirty}<span class="ml-1 text-warning-500" title="Edited">●</span>{/if}
							{#if (heldLeft ? paused : contextPaused)}
								<span class="cp-wrap-suspended font-normal opacity-60" title={WRAP_SUSPENDED}>· Not wrapped</span>
							{/if}
						</span>
						{#if heldLeft && dirty}
							<button class="cp-revert opacity-60 hover:opacity-100" on:click={revert}>Revert</button>
						{/if}
					</div>
					<div class="cp-request min-h-0 flex-1 overflow-auto dark:bg-[#282c34]">
						{#if heldLeft}
							<CodeMirror
								value={text}
								nodebounce
								on:change={edit}
								on:ready={(event) => (editor = event.detail)}
								class="text-xs"
								styles={{ "&": { fontSize: "11px" } }}
								lang={lang(text)}
								{theme}
								extensions={editExtensions}
							/>
						{:else if request}
							<CodeMirror
								value={request.Raw ?? ""}
								readonly
								editable={false}
								class="text-xs opacity-80"
								styles={{ "&": { fontSize: "11px" } }}
								lang={lang(request.Raw)}
								{theme}
								extensions={contextExtensions}
							/>
						{:else}
							<p class="p-4 text-xs opacity-60">Loading…</p>
						{/if}
					</div>
					{#if heldLeft && error}
						<div class="cp-parse-error border-t border-surface-500/30 px-3 py-1 text-[11px] text-error-500">{error}</div>
					{/if}
				{/if}
			</section>

			<!-- Right: the response, or the WebSocket message. -->
			<section class="flex min-h-0 min-w-0 flex-col">
				{#if item.Type === "request"}
					<div class={head}><span class="font-bold">Response</span></div>
					<p class="p-4 text-xs opacity-60">Not sent yet</p>
				{:else}
					<div class="{head} {heldHead}">
						<span class="font-bold">
							{item.Type === "websocket" ? "Message" : "Response"}
							<span class={chip}>Intercepted</span>
							{#if summary.status}· <span class={statusClass(summary.status)}>{summary.status}</span>{/if}
							{#if dirty}<span class="ml-1 text-warning-500" title="Edited">●</span>{/if}
							{#if paused}
								<span class="cp-wrap-suspended font-normal opacity-60" title={WRAP_SUSPENDED}>· Not wrapped</span>
							{/if}
						</span>
						{#if dirty}
							<button class="cp-revert opacity-60 hover:opacity-100" on:click={revert}>Revert</button>
						{/if}
					</div>
					<div class="cp-response min-h-0 flex-1 overflow-auto dark:bg-[#282c34]">
						<CodeMirror
							value={text}
							nodebounce
							on:change={edit}
							on:ready={(event) => (editor = event.detail)}
							class="text-xs"
							styles={{ "&": { fontSize: "11px" } }}
							lang={item.Type === "websocket" ? undefined : lang(text)}
							{theme}
							extensions={editExtensions}
						/>
					</div>
					{#if error}
						<div class="cp-parse-error border-t border-surface-500/30 px-3 py-1 text-[11px] text-error-500">{error}</div>
					{/if}
				{/if}
			</section>
		</div>
	{/key}
</div>
