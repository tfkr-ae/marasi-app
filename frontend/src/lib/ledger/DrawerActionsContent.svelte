<script>
	// Shared body of the Ledger drawer's expanded right actions column and
	// narrow-mobile right actions sidebar: grouped outbound workflow actions
	// and copy actions with active keyboard shortcuts (hidden on html.mobile).
	import { createEventDispatcher } from "svelte";
	import { menuDispatcher } from "../keybindings/app.js";
	import { shortcutLabel } from "../keybindings/keys.js";
	import { chefShown } from "../platform.js";
	import { DRAWER_ICONS } from "./drawerIcons.js";
	import { drawerCopyActions, rightRailWorkflowActions } from "./drawerPresentation.js";

	export let canOpenStream = false;
	export let hasResponse = false;
	/** Larger touch targets and active feedback for the narrow-mobile sidebar. */
	export let touch = false;

	const dispatch = createEventDispatcher();

	$: keymap = $menuDispatcher;
	$: workflow = rightRailWorkflowActions({ canOpenStream, showChef: $chefShown });
	$: copyActions = drawerCopyActions({ hasResponse });

	const heading = "px-3 pb-1 pt-3 text-3xs font-semibold uppercase tracking-wide opacity-50";
	$: rowClass = touch
		? "flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs active:bg-surface-200-700-token disabled:cursor-not-allowed disabled:opacity-35"
		: "flex w-full items-center gap-2 whitespace-nowrap px-3 py-[5px] text-left hover:bg-surface-200-700-token disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent";
	$: iconSize = touch ? 14 : 13;
</script>

<div class={heading}>Actions</div>
{#each workflow as action, idx (action.id)}
	{#if idx > 0 && workflow[idx - 1].group !== action.group}
		<div class="mx-3 my-1 flex-none border-t border-surface-300-600-token" aria-hidden="true"></div>
	{/if}
	{@const key = shortcutLabel(keymap, action.actionId)}
	<button
		type="button"
		class="{rowClass} {action.accent ? 'text-success-500' : ''}"
		on:click={() => dispatch("action", action.actionId)}
	>
		<svelte:component this={DRAWER_ICONS[action.icon]} size={iconSize} class="flex-none opacity-75" />
		<span class="flex-1">{action.label}</span>
		{#if key}
			<kbd class="text-3xs opacity-50">{key}</kbd>
		{/if}
	</button>
{/each}

<div class={heading}>Copy</div>
{#each copyActions as action, idx (action.id)}
	{@const key = shortcutLabel(keymap, action.actionId)}
	<button
		type="button"
		class="{rowClass} {idx === copyActions.length - 1 ? (touch ? 'mb-3' : 'mb-2') : ''}"
		disabled={action.disabled}
		title={action.disabled && action.disabledHint ? action.disabledHint : null}
		on:click={() => dispatch("action", action.actionId)}
	>
		<svelte:component this={DRAWER_ICONS[action.icon]} size={iconSize} class="flex-none opacity-75" />
		<span class="flex-1">{action.label}</span>
		{#if key}
			<kbd class="text-3xs opacity-50">{key}</kbd>
		{/if}
	</button>
{/each}
