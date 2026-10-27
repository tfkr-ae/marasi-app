<script>
	// A linked request and its response in the Ledger drawer's CodeMirror
	// editor, side by side (stacked when `stack`), with Wrap lines. Expand
	// opens the pair nearly full screen; Esc or a click outside closes only
	// that, not a modal under it.
	import { onDestroy } from "svelte";
	import { Maximize2, WrapText, X } from "lucide-svelte";
	import DrawerEditor from "../ledger/DrawerEditor.svelte";
	import { drawerBodies, usesSyntax } from "../ledger/drawer.js";
	import { METHOD_CLASS, statusClass } from "../launchpad/format.js";
	import { interceptModalEscape } from "../overlayIsolation.js";
	import { marasiConfig } from "../../stores";
	import { requestDetails, requestRow } from "./requestDetails.js";

	export let id;
	export let stack = false;
	/** Inside the expanded view, which has no Expand of its own. */
	export let expanded = false;
	export let wrap = true;

	let details;
	let big = false;
	$: load(id);
	async function load(requestId) {
		details = undefined;
		const row = await requestDetails(requestId);
		if (requestId === id) details = row;
	}
	$: bodies = drawerBodies(details, { prettify: false });
	$: row = requestRow(details);
	$: syntax = $marasiConfig?.SyntaxMode;

	// Inside a modal, Esc reaches the modal first; take it while expanded.
	let release = null;
	$: if (big && !release) release = interceptModalEscape(() => (big = false));
	$: if (!big && release) {
		release();
		release = null;
	}
	onDestroy(() => release?.());

	const head = "flex h-7 flex-none items-center gap-3 border-b border-surface-500/30 px-2 text-[10px] font-bold uppercase tracking-wider";
	const quiet = "flex items-center gap-1 font-normal normal-case tracking-normal hover:opacity-100";
</script>

{#if details === undefined}
	<p class="p-8 text-center text-[11px] opacity-60">Loading…</p>
{:else if details === null}
	<p class="p-8 text-center text-[11px] opacity-60">Couldn't read this request.</p>
{:else}
	<div class="grid h-full min-h-0 gap-px bg-surface-500/30 {stack ? 'grid-rows-2' : 'grid-cols-2'}" data-pair>
		{#each [["Request", bodies.request], ["Response", bodies.response]] as [label, raw], i (label)}
			<div class="flex min-h-0 min-w-0 flex-col bg-surface-50 dark:bg-surface-900">
				<div class={head}>
					<span class="flex-1 opacity-60">{label}</span>
					{#if i === 1}
						<button type="button" class="{quiet} {wrap ? 'opacity-90' : 'opacity-50'}" title="Wrap lines" on:click={() => (wrap = !wrap)}><WrapText size={11} />Wrap</button>
						{#if !expanded}
							<button type="button" class="{quiet} opacity-70" title="Open the request and response large" on:click={() => (big = true)}><Maximize2 size={11} />Expand</button>
						{/if}
					{/if}
				</div>
				<div class="min-h-0 flex-1">
					{#key id}<DrawerEditor value={raw} lang={usesSyntax(raw, syntax) ? "http" : undefined} {wrap} />{/key}
				</div>
			</div>
		{/each}
	</div>
	{#if big}
		<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
		<div data-pair-expanded class="fixed inset-0 z-[960] flex items-center justify-center bg-surface-backdrop-token p-4" on:mousedown|self={() => (big = false)}>
			<div class="card flex h-[92vh] w-[96vw] flex-col overflow-hidden rounded-none text-xs shadow-2xl bg-surface-50-800-token">
				<header class="flex h-10 flex-none items-center gap-2 border-b border-surface-500/30 px-3 font-mono text-[11px]">
					{#if row.number}<span class="opacity-60">#{row.number}</span>{/if}
					<span class="font-bold {METHOD_CLASS[row.method] ?? ''}">{row.method}</span>
					<span class="min-w-0 flex-1 truncate">{row.url}</span>
					<span class={statusClass(row.status)}>{row.status || ""}</span>
					<button type="button" class="ml-2 p-1 opacity-60 hover:opacity-100" title="Close (Esc)" aria-label="Close" on:click={() => (big = false)}><X size={15} /></button>
				</header>
				<div class="min-h-0 flex-1"><svelte:self {id} {wrap} expanded /></div>
			</div>
		</div>
	{/if}
{/if}
