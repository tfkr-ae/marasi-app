<script context="module">
	// Survive page visits within a session. The dock opens expanded on each
	// visit.
	let savedWidth;
	let savedAutoHide = false;
</script>

<script>
	// The Launchpad dock: the shared dock with the launchpad tree. With
	// auto-hide on, focusing the editor collapses it and hovering the strip
	// peeks the tree. The page binds launchpad.toggle-sidebar to toggle().
	import { writable } from "svelte/store";
	import { Eye, EyeOff } from "lucide-svelte";
	import Dock from "../dock/Dock.svelte";
	import { DOCK } from "../dock/dock.js";
	import { dirtyLaunchpadIds } from "../../stores/launchpadStore";

	export let store;
	/** The tree's search box, focused by the strip's search button. */
	export let searchInput = null;

	const dockState = writable({ width: savedWidth ?? DOCK.default, collapsed: false });
	$: savedWidth = $dockState.width;
	let autoHide = savedAutoHide;
	$: savedAutoHide = autoHide;

	let dock;

	$: dirtyCount = dirtyLaunchpadIds($store).length;
	$: current = $store.launchpads.find((l) => l.ID === $store.selectedLaunchpadId);

	export const expand = (focusSearch = false) => dock?.expand(focusSearch);
	export const toggle = () => dock?.toggle();
	/** Call when the request editor gains focus. */
	export function onEditorFocus() {
		if (autoHide) dock?.collapse();
	}
</script>

<Dock
	bind:this={dock}
	state={dockState}
	limits={DOCK}
	stripLabel={current?.Name ?? ""}
	expandLabel="Show launchpads"
	searchLabel="Search launchpads"
	{searchInput}
	peekOnHover={autoHide}
>
	<svelte:fragment slot="strip">
		{#if dirtyCount}
			<span
				class="badge variant-filled-warning px-1.5 py-0 text-3xs"
				title="{dirtyCount} unsaved {dirtyCount === 1 ? 'draft' : 'drafts'}">{dirtyCount}</span
			>
		{/if}
	</svelte:fragment>
	<svelte:fragment slot="header">
		<button
			class="flex items-center gap-1 opacity-70 hover:opacity-100"
			title="Collapse the sidebar when the editor is focused"
			aria-pressed={autoHide}
			on:click={() => (autoHide = !autoHide)}
		>
			{#if autoHide}<EyeOff size={12} />{:else}<Eye size={12} />{/if}
			Auto-hide while editing: {autoHide ? "on" : "off"}
		</button>
	</svelte:fragment>
	<slot />
</Dock>
