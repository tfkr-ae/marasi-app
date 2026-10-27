<script>
	// A linked request and its response in the Ledger drawer's CodeMirror
	// editor, side by side or stacked, with Wrap lines. Expand opens the pair
	// nearly full screen; Esc or a click outside closes only that, even over
	// a modal.
	import { onDestroy } from "svelte";
	import { Maximize2, WrapText, X } from "lucide-svelte";
	import { interceptModalEscape } from "../overlayIsolation.js";
	import DrawerEditor from "../ledger/DrawerEditor.svelte";
	import { drawerBodies, usesSyntax } from "../ledger/drawer.js";
	import { METHOD_CLASS, statusClass } from "../launchpad/format.js";
	import { marasiConfig, prettify } from "../../stores";

	/** The pair's ID. */
	export let id;
	/** Reads a pair in full (GetRawDetails), id -> Promise<row>. */
	export let read;
	/** The request above the response instead of beside it. */
	export let stack = false;
	export let wrap = true;
	/** Inside the expanded view, so no Expand of its own. */
	export let expanded = false;

	let details;
	let big = false;
	let loadingID = null;

	$: load(id);
	async function load(target) {
		loadingID = target;
		details = undefined;
		const row = await read(target).catch(() => null);
		if (String(loadingID) === String(target)) details = row;
	}

	$: bodies = details ? drawerBodies(details, { prettify: $prettify }) : { request: "", response: "" };
	$: request = details?.Request;
	$: response = details?.Response;

	function onKeydown(event) {
		if (!big || event.key !== "Escape") return;
		event.preventDefault();
		event.stopImmediatePropagation();
		big = false;
	}

	// Inside a modal, overlay isolation takes Esc before the window
	// listener above; take it there while expanded.
	let releaseEscape = null;
	$: if (big && !releaseEscape) releaseEscape = interceptModalEscape(() => (big = false));
	$: if (!big && releaseEscape) {
		releaseEscape();
		releaseEscape = null;
	}
	onDestroy(() => releaseEscape?.());
</script>

<svelte:window on:keydown|capture={onKeydown} />

<div class="logbook-pair grid h-full min-h-0 gap-px bg-surface-500/30 {stack ? 'grid-rows-2' : 'grid-cols-2'}">
	{#each [["Request", bodies.request], ["Response", bodies.response]] as [label, text], i (label)}
		<div class="flex min-h-0 min-w-0 flex-col bg-surface-50 dark:bg-surface-900">
			<div
				class="flex h-7 flex-none items-center gap-3 border-b border-surface-500/30 px-2 text-[10px] font-bold uppercase tracking-wider"
			>
				<span class="flex-1 opacity-60">{label}</span>
				{#if i === 1}
					<button
						type="button"
						class="flex items-center gap-1 font-normal normal-case tracking-normal {wrap
							? 'opacity-90'
							: 'opacity-50'} hover:opacity-100"
						title="Wrap lines"
						aria-pressed={wrap}
						on:click={() => (wrap = !wrap)}><WrapText size={11} />Wrap</button
					>
					{#if !expanded}<button
							type="button"
							class="logbook-pair-expand flex items-center gap-1 font-normal normal-case tracking-normal opacity-70 hover:opacity-100"
							title="Expand"
							on:click={() => (big = true)}><Maximize2 size={11} />Expand</button
						>{/if}
				{/if}
			</div>
			<div class="relative min-h-0 flex-1 bg-white pt-[3px] dark:bg-[#282c34]">
				{#if details === undefined}
					<p class="p-4 text-[11px] opacity-50">Loading…</p>
				{:else if details === null}
					<p class="p-4 text-[11px] opacity-60">{i ? "" : "Request not found"}</p>
				{:else}
					{#key id}<DrawerEditor
							value={text}
							lang={usesSyntax(text, $marasiConfig.SyntaxMode) ? "http" : undefined}
							{wrap}
						/>{/key}
				{/if}
			</div>
		</div>
	{/each}
</div>

{#if big}
	<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
	<div
		class="logbook-pair-expanded fixed inset-0 z-[1000] flex items-center justify-center bg-surface-backdrop-token p-4"
		on:mousedown|self|stopPropagation={() => (big = false)}
	>
		<div class="card flex h-[92vh] w-[96vw] flex-col overflow-hidden rounded-none text-xs shadow-2xl bg-surface-50-800-token">
			<header class="flex h-10 flex-none items-center gap-2 border-b border-surface-500/30 px-3 font-mono text-[11px]">
				{#if request}
					<span class="opacity-60">#{request.Number}</span>
					<span class="font-bold {METHOD_CLASS[request.Method] ?? ''}">{request.Method}</span>
					<span class="min-w-0 flex-1 truncate">{request.Host}{request.Path}</span>
					<span class={statusClass(response?.StatusCode)}>{response?.StatusCode || ""}</span>
				{:else}<span class="flex-1"></span>{/if}
				<button class="ml-2 p-1 opacity-60 hover:opacity-100" title="Close (Esc)" aria-label="Close" on:click={() => (big = false)}
					><X size={15} /></button
				>
			</header>
			<div class="min-h-0 flex-1"><svelte:self {id} {read} bind:wrap expanded /></div>
		</div>
	</div>
{/if}
