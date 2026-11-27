<script>
	// The Ledger drawer's right edge: a collapsed icon rail of grouped outbound
	// workflow actions that expands via the command strip's right corner toggle
	// into the actions column listing every workflow and copy action with its
	// label and active shortcut. All actions dispatch their catalog action id.
	import { createEventDispatcher } from "svelte";
	import { menuDispatcher } from "../keybindings/app.js";
	import { chefShown } from "../platform.js";
	import DrawerActionsContent from "./DrawerActionsContent.svelte";
	import { DRAWER_ICONS } from "./drawerIcons.js";
	import { rightRailWorkflowActions, shortcutTooltip } from "./drawerPresentation.js";

	/** Whether the actions column shows instead of the collapsed rail. */
	export let expanded = false;
	/** Whether the pair is a WebSocket upgrade or streamed pair. */
	export let canOpenStream = false;
	/** Whether the pair has a response (enables Copy response). */
	export let hasResponse = false;

	const dispatch = createEventDispatcher();

	$: keymap = $menuDispatcher;
	$: workflow = rightRailWorkflowActions({ canOpenStream, showChef: $chefShown });

	const railButton = "flex h-7 w-8 flex-none items-center justify-center hover:bg-surface-200-700-token";
	const divider = "my-1 w-5 flex-none border-t border-surface-300-600-token";
</script>

{#if expanded}
	<aside
		class="ledger-drawer-column ledger-drawer-right-column flex w-56 flex-none flex-col overflow-y-auto border-l border-surface-300-600-token bg-surface-50 text-2xs dark:bg-surface-900"
		aria-label="Pair actions"
	>
		<DrawerActionsContent {canOpenStream} {hasResponse} on:action />
	</aside>
{:else}
	<nav
		class="ledger-drawer-rail ledger-drawer-right-rail flex w-9 flex-none flex-col items-center border-l border-surface-300-600-token bg-surface-50 py-1 dark:bg-surface-900"
		aria-label="Pair workflow actions"
	>
		{#each workflow as action, idx (action.id)}
			{#if idx > 0 && workflow[idx - 1].group !== action.group}
				<div class={divider} aria-hidden="true"></div>
			{/if}
			<button
				type="button"
				class="{railButton} {action.accent ? 'text-success-500' : ''}"
				title={shortcutTooltip(action.label, action.actionId, keymap)}
				aria-label={action.label}
				on:click={() => dispatch("action", action.actionId)}
			>
				<svelte:component this={DRAWER_ICONS[action.icon]} size={14} />
			</button>
		{/each}
	</nav>
{/if}
