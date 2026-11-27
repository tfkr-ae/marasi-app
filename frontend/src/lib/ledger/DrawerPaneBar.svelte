<script>
	// Thin 50/50 pane identifier bar directly above the side-by-side Ledger
	// drawer editors: Request + byte length + Copy on the left; Response | Note
	// | Metadata switcher + response length / note save state + Copy (for
	// Response and Metadata) on the right.
	import { createEventDispatcher } from "svelte";
	import { Copy } from "lucide-svelte";
	import { menuDispatcher } from "../keybindings/app.js";
	import { paneHeaderState, shortcutTooltip } from "./drawerPresentation.js";

	/** "note" or "metadata" while one shows in place of the response; null for Response. */
	export let pane = null;
	export let requestBody = "";
	export let responseBody = "";
	export let metadataBody = null;
	export let hasResponse = false;
	export let hasNote = false;
	export let noteStatus = "saved";

	const dispatch = createEventDispatcher();

	$: keymap = $menuDispatcher;
	$: header = paneHeaderState({
		pane,
		requestBody,
		responseBody,
		metadataBody,
		hasResponse,
		hasNote,
		noteStatus,
	});

	function copyRight() {
		const copy = header.right.copy;
		if (!copy || copy.disabled) return;
		if (copy.kind === "metadata") dispatch("copymetadata");
		else if (copy.actionId) dispatch("action", copy.actionId);
	}

	const copyBtn =
		"inline-flex h-5 flex-none items-center gap-1 px-1 text-3xs opacity-60 hover:bg-surface-200-700-token hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent";
</script>

<div
	class="ledger-drawer-pane-bar grid h-6 flex-none grid-cols-2 border-b border-surface-300-600-token bg-surface-50 dark:bg-surface-900"
>
	<div class="flex min-w-0 items-center justify-between gap-2 px-2.5">
		<div class="flex min-w-0 items-center gap-1.5">
			<span class="h-1.5 w-1.5 flex-none rounded-full bg-primary-500" aria-hidden="true"></span>
			<span class="text-3xs font-semibold uppercase tracking-wider opacity-80">{header.left.label}</span>
			{#if header.left.sizeText}
				<span class="font-mono text-3xs tabular-nums opacity-45">{header.left.sizeText}</span>
			{/if}
		</div>
		<button
			type="button"
			class={copyBtn}
			title={shortcutTooltip(header.left.copy.label, header.left.copy.actionId, keymap)}
			aria-label={header.left.copy.label}
			on:click={() => dispatch("action", header.left.copy.actionId)}
		>
			<Copy size={10} /><span>Copy</span>
		</button>
	</div>

	<div class="flex min-w-0 items-center justify-between gap-2 border-l border-surface-300-600-token px-2">
		<div class="flex min-w-0 items-center gap-1" role="tablist" aria-label="Right pane">
			{#each header.right.tabs as tab (tab.label)}
				<button
					type="button"
					role="tab"
					aria-selected={header.right.activePane === tab.id}
					data-status={tab.id === "note" ? noteStatus : null}
					class="inline-flex h-5 flex-none items-center gap-1 px-1.5 text-3xs font-semibold uppercase tracking-wider {header
						.right.activePane === tab.id
						? 'bg-surface-200-700-token text-primary-500'
						: 'opacity-50 hover:opacity-90'}"
					title={tab.actionId ? shortcutTooltip(tab.title, tab.actionId, keymap) : tab.title}
					on:click={() => dispatch("pane", tab.id)}
				>
					<span>{tab.label}</span>
					{#if tab.dot}
						<span class="h-1.5 w-1.5 flex-none rounded-full {tab.dot}" aria-hidden="true"></span>
					{/if}
				</button>
			{/each}
		</div>

		<div class="flex flex-none items-center gap-1.5">
			{#if header.right.metaText}
				{#if pane === "note"}
					<span class="text-3xs {header.right.metaTone}" role="status">{header.right.metaText}</span>
				{:else}
					<span class="font-mono text-3xs tabular-nums {header.right.metaTone}">{header.right.metaText}</span>
				{/if}
			{/if}
			{#if header.right.copy}
				<button
					type="button"
					class={copyBtn}
					disabled={header.right.copy.disabled}
					title={header.right.copy.disabled && header.right.copy.disabledHint
						? header.right.copy.disabledHint
						: shortcutTooltip(header.right.copy.label, header.right.copy.actionId, keymap)}
					aria-label={header.right.copy.label}
					on:click={copyRight}
				>
					<Copy size={10} /><span>Copy</span>
				</button>
			{/if}
		</div>
	</div>
</div>

<style>
	/* Narrow mobile screens use PaneTabs until the unified mobile pane bar lands. */
	@media (max-width: 40rem) {
		:global(html.mobile .ledger-drawer-pane-bar) {
			display: none;
		}
	}
</style>
