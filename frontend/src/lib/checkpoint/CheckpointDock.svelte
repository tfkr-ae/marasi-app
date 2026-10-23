<script context="module">
	// The dock's width survives page visits within a session.
	let savedWidth;
</script>

<script>
	// The Checkpoint dock: Intercept all, Forward n / Drop n, and the
	// intercepted items in a tree grouped by host, in hold order within each
	// host. A click selects; ⌘-click and shift-click pick.
	import { writable } from "svelte/store";
	import { modeCurrent, SlideToggle } from "@skeletonlabs/skeleton";
	import { ChevronDown, ChevronRight, Forward, Globe, Rocket, X } from "lucide-svelte";
	import Dock from "../dock/Dock.svelte";
	import { CHECKPOINT_DOCK } from "../dock/dock.js";
	import { METHOD_CLASS, primaryVariant, statusClass } from "../launchpad/format.js";
	import { isDirty, parseErrorOf } from "../../stores/checkpointStore";
	import { interceptFlag } from "../../stores/interceptFlag.js";
	import { bulkTargets, interceptedFor, treeOrder } from "./items.js";
	import KindTag from "./KindTag.svelte";

	export let store;
	/** [{ host, items: [{ ID, item, summary, launch }] }] in tree order. */
	export let groups = [];
	/** Date.now(), ticking, for how long each item has been intercepted. */
	export let now = Date.now();
	export let onBulk = (kind, ids) => {};
	export let onToggleIntercept = () => {};
	/** Hosts the researcher collapsed; the page reads it for ↑/↓. */
	export let collapsed = new Set();

	const dockState = writable({ width: savedWidth ?? CHECKPOINT_DOCK.default, collapsed: false });
	$: savedWidth = $dockState.width;

	$: state = $store;
	$: primary = primaryVariant($modeCurrent);
	$: targets = bulkTargets(state);
	$: picked = new Set(state.picked);

	function toggleHost(host) {
		const next = new Set(collapsed);
		next.has(host) ? next.delete(host) : next.add(host);
		collapsed = next;
	}

	function clickEntry(event, id) {
		const range = event.shiftKey;
		store.pick(id, {
			toggle: !range && (event.metaKey || event.ctrlKey),
			range,
			order: treeOrder(groups, collapsed),
		});
	}

	// Keeps the selected entry in view as ↑/↓ move it.
	function reveal(node, active) {
		const show = (on) => on && node.scrollIntoView({ block: "nearest" });
		show(active);
		return { update: show };
	}
</script>

<Dock state={dockState} limits={CHECKPOINT_DOCK} stripLabel="Intercepted" expandLabel="Show intercepted" searchLabel="Show intercepted">
	<svelte:fragment slot="strip">
		{#if state.items.length}
			<span class="badge variant-filled-warning px-1.5 py-0 text-[10px]" title="{state.items.length} intercepted"
				>{state.items.length}</span
			>
		{/if}
	</svelte:fragment>
	<svelte:fragment slot="header">
		<span class="cp-count mr-auto px-1 text-xs font-bold"
			>Intercepted <span class="text-[10px] font-normal opacity-70">{state.items.length}</span></span
		>
	</svelte:fragment>

	<div class="flex h-full min-h-0 flex-col">
		<div class="flex items-center gap-2 border-b border-surface-500/30 px-2 py-1.5 text-xs">
			<div class="cp-intercept-all" title="Intercept every request and response, whatever the rules say">
				<SlideToggle name="Intercept all" size="sm" active="bg-success-500" checked={$interceptFlag} on:change={onToggleIntercept}
					><span class="text-xs">Intercept all</span></SlideToggle
				>
			</div>
			<span class="flex-1"></span>
			<button
				class="cp-forward-n btn btn-sm {primary}"
				disabled={!targets.length}
				title={state.picked.length ? "Forward the picked items" : "Forward every item"}
				on:click={() => onBulk("forward", targets)}
			>
				<Forward size={12} class="mr-1" />Forward {targets.length}
			</button>
			<button
				class="cp-drop-n btn btn-sm {primary}"
				disabled={!targets.length}
				title={state.picked.length ? "Drop the picked items" : "Drop every item"}
				on:click={() => onBulk("drop", targets)}
			>
				<X size={12} class="mr-1" />Drop {targets.length}
			</button>
		</div>
		{#if state.picked.length}
			<div class="flex items-center justify-between border-b border-surface-500/30 bg-primary-500/10 px-2 py-0.5 text-[10px]">
				<span>{state.picked.length} picked</span>
				<button class="cp-clear-picks btn btn-sm {primary} px-2 py-0 text-[10px]" on:click={() => state.selectedId && store.pick(state.selectedId)}>Clear</button>
			</div>
		{/if}
		<div class="cp-tree min-h-0 flex-1 overflow-auto" role="tree" aria-label="Intercepted items">
			{#if !groups.length}
				<p class="p-4 text-center text-xs opacity-60">Nothing intercepted</p>
			{/if}
			{#each groups as group (group.host)}
				{@const open = !collapsed.has(group.host)}
				<button
					class="cp-host sticky top-0 z-10 flex w-full items-center gap-1.5 border-b border-surface-500/20 bg-surface-100 px-2 py-1 text-left text-[11px] font-semibold dark:bg-surface-800"
					aria-expanded={open}
					on:click={() => toggleHost(group.host)}
				>
					{#if open}<ChevronDown size={12} />{:else}<ChevronRight size={12} />{/if}
					<Globe size={12} class="opacity-60" />
					<span class="flex-1 truncate">{group.host || "Unknown host"}</span>
					<span class="text-[10px] opacity-60">{group.items.length}</span>
				</button>
				{#if open}
					<div class="relative">
						<span class="absolute bottom-0 left-[13px] top-0 w-px bg-surface-500/30"></span>
						{#each group.items as entry (entry.item.ID + entry.item.Type)}
							{@const item = entry.item}
							{@const summary = entry.summary}
							{@const selected = item.ID === state.selectedId}
							{@const isPicked = picked.has(item.ID)}
							{@const error = parseErrorOf(state, item.ID)}
							<!-- svelte-ignore a11y-click-events-have-key-events a11y-interactive-supports-focus -->
							<div
								role="treeitem"
								aria-selected={selected}
								data-item={item.ID}
								data-picked={isPicked ? "true" : undefined}
								class="cp-entry relative flex cursor-default select-none items-center gap-1.5 py-[3px] pl-6 pr-2 font-mono text-[11px] {selected
									? 'bg-primary-500/20'
									: isPicked
										? 'bg-primary-500/15'
										: 'hover:bg-surface-200/70 dark:hover:bg-surface-700/60'}"
								use:reveal={selected}
								on:click={(event) => clickEntry(event, item.ID)}
							>
								{#if selected || isPicked}<span class="absolute bottom-0 left-0 top-0 w-[3px] bg-primary-500"></span>{/if}
								<KindTag type={item.Type} />
								{#if item.Type === "response"}
									<span class="w-10 flex-none {statusClass(summary.status)}">{summary.status || ""}</span>
								{:else if item.Type === "websocket"}
									<span class="w-10 flex-none opacity-70">{summary.method}</span>
								{:else}
									<span class="w-10 flex-none truncate {METHOD_CLASS[summary.method] ?? ''}">{summary.method}</span>
								{/if}
								<span class="min-w-0 flex-1 truncate" title={summary.path}>{summary.path}</span>
								{#if entry.launch}
									<span class="flex-none" title="From Launchpad · {entry.launch}"><Rocket size={11} class="opacity-70" /></span>
								{/if}
								{#if error}<span class="flex-none font-bold text-error-500" title={error}>!</span>{/if}
								{#if isDirty(state, item.ID)}<span class="flex-none text-warning-500" title="Edited">●</span>{/if}
								<span class="w-7 flex-none text-right text-[10px] tabular-nums opacity-60" title="Intercepted for"
									>{interceptedFor(item.InterceptedAt, now)}</span
								>
							</div>
						{/each}
					</div>
				{/if}
			{/each}
		</div>
	</div>
</Dock>
