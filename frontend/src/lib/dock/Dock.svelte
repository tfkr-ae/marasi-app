<script>
	// A side dock, shared by the Launchpad and the Ledger: drag the edge to
	// resize, drag below the snap point to collapse to a strip. The strip has
	// an expand button, a search button and a vertical label. With
	// `peekOnHover`, hovering the strip shows the panel over the page.
	//
	// `state` is a store of { width, collapsed } with `set`; the owner decides
	// how long it lasts. A `header` slot puts a header row with a collapse
	// button above the content; without one, the collapse button floats in
	// the panel's top-right corner.
	import { tick } from "svelte";
	import { PanelLeftClose, PanelLeftOpen, Search } from "lucide-svelte";
	import { DOCK, dragWidth, settleDrag, toggleDock } from "./dock.js";

	export let state;
	export let limits = DOCK;
	/** Shown vertically on the strip. */
	export let stripLabel = "";
	export let expandLabel = "Show sidebar";
	export let searchLabel = "Search";
	export let collapseLabel = "Collapse sidebar";
	/** Focused by the strip's search button after the dock expands. */
	export let searchInput = null;
	export let peekOnHover = false;

	let peeking = false;
	let dragging = false;
	let liveWidth = $state.width;
	let peekTimer;

	$: collapsed = $state.collapsed;
	$: width = $state.width;
	$: panelWidth = dragging ? liveWidth : width;
	$: overlay = collapsed && peeking && !dragging;
	$: if (!peekOnHover) peeking = false;

	function setDock(next) {
		state.set({ ...$state, ...next });
	}

	export async function expand(focusSearch = false) {
		setDock({ collapsed: false });
		peeking = false;
		if (focusSearch) {
			await tick();
			searchInput?.focus();
		}
	}
	export function collapse() {
		setDock({ collapsed: true });
		peeking = false;
	}
	export function toggle() {
		peeking = false;
		setDock(toggleDock($state));
	}

	function peek(on, delay) {
		if (!peekOnHover) return;
		clearTimeout(peekTimer);
		peekTimer = setTimeout(() => (peeking = on), delay);
	}

	function startDrag(event) {
		const startX = event.clientX;
		const startWidth = collapsed ? 0 : width;
		dragging = true;
		liveWidth = startWidth;
		setDock({ collapsed: false });
		const move = (e) => (liveWidth = dragWidth(startWidth, e.clientX - startX, limits));
		const up = () => {
			dragging = false;
			setDock(settleDrag(liveWidth, width, limits));
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	}
</script>

{#if collapsed && !dragging}
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<aside
		class="lp-strip z-30 flex w-11 flex-none flex-col items-center gap-2 border-r border-surface-500/30 bg-surface-50 py-2 dark:bg-surface-900"
		on:mouseenter={() => peek(true, 150)}
		on:mouseleave={() => peek(false, 250)}
	>
		<button
			class="btn btn-sm variant-soft px-2"
			title={expandLabel}
			aria-label={expandLabel}
			on:click={() => expand()}
		>
			<PanelLeftOpen size={16} />
		</button>
		<button
			class="btn btn-sm hover:variant-soft px-2"
			title={searchLabel}
			aria-label={searchLabel}
			on:click={() => expand(true)}
		>
			<Search size={16} />
		</button>
		<slot name="strip" />
		<button
			class="mt-2 max-h-[60vh] truncate text-xs font-bold opacity-70 [writing-mode:vertical-rl] hover:opacity-100"
			title={stripLabel}
			on:click={() => expand()}
		>
			{stripLabel}
		</button>
	</aside>
{/if}

{#if !collapsed || dragging || peeking}
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<aside
		class="lp-dock {overlay
			? 'absolute bottom-0 left-11 top-0 z-20 shadow-2xl'
			: 'relative flex-none'} flex flex-col overflow-hidden border-r border-surface-500/30 bg-surface-50 dark:bg-surface-900"
		style="width: {overlay ? width : panelWidth}px"
		on:mouseenter={() => clearTimeout(peekTimer)}
		on:mouseleave={() => collapsed && peek(false, 250)}
	>
		<!-- Content keeps at least the minimum width while dragging narrower. -->
		<div class="flex h-full min-h-0 flex-col" style="width: {Math.max(overlay ? width : panelWidth, limits.min)}px">
			{#if $$slots.header}
				<div
					class="flex items-center justify-end gap-2 border-b border-surface-500/30 bg-surface-50 px-2 py-1 text-3xs dark:bg-surface-900"
				>
					<slot name="header" />
					{#if !collapsed}
						<button
							class="opacity-70 hover:opacity-100"
							title="Collapse"
							aria-label={collapseLabel}
							on:click={collapse}
						>
							<PanelLeftClose size={12} />
						</button>
					{/if}
				</div>
			{/if}
			<div class="min-h-0 flex-1">
				<slot />
			</div>
		</div>
		{#if !$$slots.header && !collapsed}
			<button
				class="absolute right-1.5 top-1.5 z-20 opacity-50 hover:opacity-100"
				title="Collapse"
				aria-label={collapseLabel}
				on:click={collapse}
			>
				<PanelLeftClose size={13} />
			</button>
		{/if}
		{#if dragging && liveWidth < limits.snap}
			<div class="absolute inset-0 flex items-center justify-center bg-surface-900/70 text-xs text-white">
				Release to collapse
			</div>
		{/if}
	</aside>
{/if}

{#if !collapsed || dragging}
	<!-- The resize handle takes no width: its grab area and highlight sit
	     over the dock's border and the content's edge, so hovering or
	     dragging never moves the layout. -->
	<div class="relative w-0 flex-none">
		<!-- svelte-ignore a11y-no-static-element-interactions -->
		<div
			class="lp-resize absolute inset-y-0 -left-1 z-30 w-2 cursor-col-resize transition-colors hover:bg-primary-500/60 {dragging
				? 'bg-primary-500'
				: ''}"
			title="Drag to resize, drag left to collapse"
			on:pointerdown|preventDefault={startDrag}
		></div>
	</div>
{/if}
