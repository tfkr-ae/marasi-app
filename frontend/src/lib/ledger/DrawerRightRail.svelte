<script>
	// The Ledger drawer's right edge: a collapsed icon rail of grouped outbound
	// workflow actions that expands via the command strip's right corner toggle
	// into the actions column listing every workflow and copy action with its
	// label and active shortcut. All actions dispatch their catalog action id.
	import { createEventDispatcher } from "svelte";
	import {
		BookCheck,
		CookingPot,
		Copy,
		FileOutput,
		Globe,
		Link,
		Radio,
		Send,
		Shapes,
		ShieldAlert,
		Swords,
	} from "lucide-svelte";
	import { menuDispatcher } from "../keybindings/app.js";
	import { shortcutLabel } from "../keybindings/keys.js";
	import { chefShown } from "../platform.js";
	import {
		drawerCopyActions,
		rightRailWorkflowActions,
		shortcutTooltip,
	} from "./drawerPresentation.js";

	/** Whether the actions column shows instead of the collapsed rail. */
	export let expanded = false;
	/** Whether the pair is a WebSocket upgrade or streamed pair. */
	export let canOpenStream = false;
	/** Whether the pair has a response (enables Copy response). */
	export let hasResponse = false;

	const dispatch = createEventDispatcher();
	const ICONS = {
		radio: Radio,
		send: Send,
		swords: Swords,
		shapes: Shapes,
		"cooking-pot": CookingPot,
		"shield-alert": ShieldAlert,
		"book-check": BookCheck,
		copy: Copy,
		"file-output": FileOutput,
		link: Link,
		globe: Globe,
	};

	$: keymap = $menuDispatcher;
	$: workflow = rightRailWorkflowActions({ canOpenStream, showChef: $chefShown });
	$: copyActions = drawerCopyActions({ hasResponse });

	const run = (actionId) => dispatch("action", actionId);

	const railButton = "flex h-7 w-8 flex-none items-center justify-center hover:bg-surface-200-700-token";
	const heading = "px-3 pb-1 pt-3 text-3xs font-semibold uppercase tracking-wide opacity-50";
	const row =
		"flex w-full items-center gap-2 whitespace-nowrap px-3 py-[5px] text-left hover:bg-surface-200-700-token disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent";
	const divider = "my-1 w-5 flex-none border-t border-surface-300-600-token";
</script>

{#if expanded}
	<aside
		class="ledger-drawer-column ledger-drawer-right-column flex w-56 flex-none flex-col overflow-y-auto border-l border-surface-300-600-token bg-surface-50 text-2xs dark:bg-surface-900"
		aria-label="Pair actions"
	>
		<div class={heading}>Actions</div>
		{#each workflow as action, idx (action.id)}
			{#if idx > 0 && workflow[idx - 1].group !== action.group}
				<div class="mx-3 my-1 flex-none border-t border-surface-300-600-token" aria-hidden="true"></div>
			{/if}
			{@const key = shortcutLabel(keymap, action.actionId)}
			<button
				type="button"
				class="{row} {action.accent ? 'text-success-500' : ''}"
				on:click={() => run(action.actionId)}
			>
				<svelte:component this={ICONS[action.icon]} size={13} class="flex-none opacity-75" />
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
				class="{row} {idx === copyActions.length - 1 ? 'mb-2' : ''}"
				disabled={action.disabled}
				title={action.disabled && action.disabledHint ? action.disabledHint : null}
				on:click={() => run(action.actionId)}
			>
				<svelte:component this={ICONS[action.icon]} size={13} class="flex-none opacity-75" />
				<span class="flex-1">{action.label}</span>
				{#if key}
					<kbd class="text-3xs opacity-50">{key}</kbd>
				{/if}
			</button>
		{/each}
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
				on:click={() => run(action.actionId)}
			>
				<svelte:component this={ICONS[action.icon]} size={14} />
			</button>
		{/each}
	</nav>
{/if}
