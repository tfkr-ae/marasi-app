<script>
	// A Ledger toolbar menu: a button with an icon, a label and an optional
	// badge, opening a panel under it. A click outside the menu or Esc closes
	// it. The panel's content is the default slot, which gets `close`.
	import { createEventDispatcher } from "svelte";
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import { primaryVariant } from "../launchpad/format.js";

	export let label;
	/** A lucide-svelte icon component. */
	export let icon = null;
	/** Shown beside the label when not empty, such as a count of active terms. */
	export let badge = "";
	export let title = "";
	export let open = false;
	/** Classes for the panel's size, such as "w-64". */
	export let panelClass = "w-72";
	/** Prefix for the button's and panel's ids. */
	export let id;
	/** Keeps the menu open on a click outside, such as in a dialog the menu opened. */
	export let stayOpen = false;
	/** Greys the menu out in place; it can't open. */
	export let disabled = false;
	/** A fixed width for the menu, such as "w-44 flex-none", so a badge never moves what sits beside it. */
	export let widthClass = "";

	const dispatch = createEventDispatcher();
	let root;

	$: if (disabled) open = false;

	$: primary = primaryVariant($modeCurrent);

	function toggle() {
		open = !open;
		if (open) dispatch("open");
	}

	function close() {
		open = false;
	}

	function onWindowPointerDown(event) {
		if (open && !stayOpen && root && !root.contains(event.target)) close();
	}

	function onKeydown(event) {
		if (event.key === "Escape" && open) {
			event.stopPropagation();
			close();
			root?.querySelector("button")?.focus();
		}
	}
</script>

<svelte:window on:pointerdown={onWindowPointerDown} />

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
	class="relative flex items-stretch border-l border-surface-300-600-token {widthClass}"
	bind:this={root}
	on:keydown={onKeydown}
>
	<button
		id="{id}Button"
		type="button"
		class="flex min-w-0 flex-1 items-center gap-1.5 px-3 text-sm {disabled
			? 'cursor-not-allowed opacity-40'
			: 'hover:bg-surface-200-700-token'} {open ? 'bg-surface-200-700-token' : ''}"
		{title}
		{disabled}
		aria-haspopup="true"
		aria-expanded={open}
		aria-controls="{id}Panel"
		on:click={toggle}
	>
		{#if icon}<svelte:component this={icon} size={15} class="opacity-70" />{/if}
		{label}
		{#if badge !== ""}
			<span class="badge {primary} max-w-[9rem] truncate px-1.5 py-0 text-3xs">{badge}</span>
		{/if}
	</button>
	{#if open}
		<div
			id="{id}Panel"
			class="card absolute right-0 top-full z-40 mt-1 max-h-[60vh] overflow-auto shadow-xl {panelClass}"
			role="dialog"
			aria-label={label}
		>
			<slot {close} />
		</div>
	{/if}
</div>
