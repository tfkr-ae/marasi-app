<script>
	// The Armory drawer's left edge, shaped like the Ledger's DrawerRail: a
	// thin icon rail that expands into a details column with the pair's facts
	// and the labelled actions. The `details` slot, below the facts, is for
	// what the pair is linked to. Actions opens the row menu, anchored at the
	// button that was clicked.
	import {
		ChevronDown,
		ChevronUp,
		Copy,
		FileOutput,
		Link,
		ListChecks,
		Maximize2,
		Minimize2,
		PanelLeftClose,
		PanelLeftOpen,
		X,
	} from "lucide-svelte";
	import { menuDispatcher } from "../keybindings/app.js";
	import { shortcutLabel } from "../keybindings/keys.js";
	import DrawerFacts from "../ledger/DrawerFacts.svelte";

	/** The open pair's table row, and its request number. */
	export let pair;
	export let number;
	/** Whether the details column shows instead of the rail. */
	export let expanded = false;
	export let maximised = false;
	export let timing = "";
	export let onExpand = (expanded) => {};
	export let onClose = () => {};
	export let onMaximise = () => {};
	export let onStep = (delta) => {};
	/** "request", "response" or "url". */
	export let onCopy = (what) => {};
	/** The click on an Actions button; its currentTarget anchors the menu. */
	export let onActions = (event) => {};

	const DRAWER = "armory.drawer";

	$: hasResponse = Number(pair.StatusCode) > 0;
	$: copies = [
		{ label: "Copy request", icon: Copy, what: "request" },
		{ label: "Copy response", icon: FileOutput, what: "response", disabled: !hasResponse },
		{ label: "Copy URL", icon: Link, what: "url" },
	];

	// "Label (⌘⇧])", or the label alone when the action has no shortcut.
	function tip(label, actionId, keymap) {
		const key = actionId && shortcutLabel(keymap, actionId);
		return key ? `${label} (${key})` : label;
	}
	$: keymap = $menuDispatcher;
	$: maximiseLabel = maximised ? "Restore the workspace" : "Maximise the drawer";
	$: ExpandIcon = expanded ? PanelLeftClose : PanelLeftOpen;

	const railButton =
		"flex h-7 w-8 flex-none items-center justify-center rounded-sm hover:bg-surface-200-700-token disabled:pointer-events-none disabled:opacity-40";
	const headerButton = "flex h-6 w-6 flex-none items-center justify-center rounded-sm hover:bg-surface-200-700-token";
	const heading = "px-3 pb-1 pt-3 text-3xs font-semibold uppercase tracking-wide opacity-50";
	const row =
		"flex w-full items-center gap-2 whitespace-nowrap px-3 py-[5px] text-left hover:bg-surface-200-700-token disabled:pointer-events-none disabled:opacity-40";
	const divider = "my-1 w-5 flex-none border-t border-surface-300-600-token";
</script>

{#if expanded}
	<aside
		class="armory-drawer-column flex w-60 flex-none flex-col overflow-y-auto border-r border-surface-300-600-token bg-surface-50 text-2xs dark:bg-surface-900"
		aria-label="Request details"
	>
		<div class="flex h-7 flex-none flex-nowrap items-center gap-0.5 border-b border-surface-300-600-token px-2">
			<button
				class="armory-drawer-expand {headerButton}"
				title="Collapse the details to the rail"
				aria-label="Collapse the details"
				aria-expanded="true"
				on:click={() => onExpand(false)}><svelte:component this={ExpandIcon} size={14} /></button
			>
			<span class="min-w-0 flex-1 truncate pl-1 font-mono text-2xs opacity-60">#{number}</span>
			<button
				class={headerButton}
				title={tip("Previous request", `${DRAWER}.previous-request`, keymap)}
				aria-label="Previous request"
				on:click={() => onStep(-1)}><ChevronUp size={14} /></button
			>
			<button
				class={headerButton}
				title={tip("Next request", `${DRAWER}.next-request`, keymap)}
				aria-label="Next request"
				on:click={() => onStep(1)}><ChevronDown size={14} /></button
			>
			<button
				class={headerButton}
				title={maximiseLabel}
				aria-label={maximiseLabel}
				aria-pressed={maximised}
				on:click={onMaximise}
			>
				{#if maximised}<Minimize2 size={13} />{:else}<Maximize2 size={13} />{/if}
			</button>
			<button class={headerButton} title="Close (Esc)" aria-label="Close the drawer" on:click={onClose}
				><X size={14} /></button
			>
		</div>

		<DrawerFacts {pair} {timing} prefix="armory" />

		<slot name="details" />

		<div class={heading}>Actions</div>
		{#each copies as copy (copy.what)}
			<button class={row} disabled={copy.disabled} on:click={() => onCopy(copy.what)}>
				<svelte:component this={copy.icon} size={13} class="flex-none opacity-70" />
				<span class="flex-1">{copy.label}</span>
			</button>
		{/each}
		<div class="mx-3 my-1 flex-none border-t border-surface-300-600-token"></div>
		<button class="armory-drawer-actions {row} mb-2" aria-haspopup="menu" on:click={onActions}>
			<ListChecks size={13} class="flex-none opacity-70" />
			<span class="flex-1">More actions</span>
			<ChevronDown size={12} class="opacity-50" />
		</button>
	</aside>
{:else}
	<nav
		class="armory-drawer-rail flex w-9 flex-none flex-col items-center overflow-y-auto border-r border-surface-300-600-token bg-surface-50 pb-0.5 [scrollbar-width:none] dark:bg-surface-900"
		aria-label="Request actions"
	>
		<button
			class="armory-drawer-expand {railButton}"
			title="Show the details"
			aria-label="Show the details"
			aria-expanded="false"
			on:click={() => onExpand(true)}><svelte:component this={ExpandIcon} size={14} /></button
		>
		<button class={railButton} title="Close (Esc)" aria-label="Close the drawer" on:click={onClose}
			><X size={14} /></button
		>
		<button
			class={railButton}
			title={maximiseLabel}
			aria-label={maximiseLabel}
			aria-pressed={maximised}
			on:click={onMaximise}
		>
			{#if maximised}<Minimize2 size={13} />{:else}<Maximize2 size={13} />{/if}
		</button>
		<button
			class={railButton}
			title={tip("Previous request", `${DRAWER}.previous-request`, keymap)}
			aria-label="Previous request"
			on:click={() => onStep(-1)}><ChevronUp size={14} /></button
		>
		<button
			class={railButton}
			title={tip("Next request", `${DRAWER}.next-request`, keymap)}
			aria-label="Next request"
			on:click={() => onStep(1)}><ChevronDown size={14} /></button
		>
		<div class={divider}></div>
		{#each copies as copy (copy.what)}
			<button
				class={railButton}
				title={copy.label}
				aria-label={copy.label}
				disabled={copy.disabled}
				on:click={() => onCopy(copy.what)}><svelte:component this={copy.icon} size={14} /></button
			>
		{/each}
		<div class={divider}></div>
		<button
			class="armory-drawer-actions {railButton}"
			title="Actions"
			aria-label="Actions"
			aria-haspopup="menu"
			on:click={onActions}><ListChecks size={14} /></button
		>
	</nav>
{/if}
