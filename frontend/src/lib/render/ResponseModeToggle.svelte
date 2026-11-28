<script>
	// Square-edged Raw | Render segmented control for HTTP response pane headers.
	import { createEventDispatcher } from "svelte";
	import { menuDispatcher } from "../keybindings/app.js";
	import { shortcutTooltip } from "../ledger/drawerPresentation.js";

	/** "raw" | "render" */
	export let mode = "raw";
	export let disabled = false;
	/** Optional catalog action id (e.g. "ledger.drawer-open.toggle-render") for live shortcut tooltips. */
	export let actionId = null;

	const dispatch = createEventDispatcher();
	$: keymap = $menuDispatcher;
	$: rawTitle = shortcutTooltip("Raw HTTP", actionId, keymap);
	$: renderTitle = shortcutTooltip("Render preview", actionId, keymap);

	function pick(next) {
		if (disabled || mode === next) return;
		mode = next;
		dispatch("change", next);
	}

	const seg =
		"inline-flex h-5 flex-none items-center px-1.5 text-3xs font-semibold uppercase tracking-wider disabled:cursor-not-allowed disabled:opacity-30";
</script>

<div
	class="response-mode-toggle inline-flex flex-none items-center border border-surface-300-600-token bg-surface-50 dark:bg-surface-900"
	role="tablist"
	aria-label="Response view mode"
	data-response-mode={mode}
>
	<button
		type="button"
		role="tab"
		aria-selected={mode === "raw"}
		{disabled}
		title={rawTitle}
		class="{seg} {mode === 'raw' ? 'bg-surface-200-700-token text-primary-500' : 'opacity-50 hover:opacity-90'}"
		on:click={() => pick("raw")}
	>
		Raw
	</button>
	<button
		type="button"
		role="tab"
		aria-selected={mode === "render"}
		{disabled}
		title={renderTitle}
		class="{seg} border-l border-surface-300-600-token {mode === 'render'
			? 'bg-surface-200-700-token text-primary-500'
			: 'opacity-50 hover:opacity-90'}"
		on:click={() => pick("render")}
	>
		Render
	</button>
</div>
