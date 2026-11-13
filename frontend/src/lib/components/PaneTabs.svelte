<script>
	// Tabs for two side-by-side panes (a request and its response) on a
	// narrow iOS screen, the iPhone Duo folded: only the active pane shows
	// there (app.css, .pane-tabs and .pane-off). Elsewhere the tabs are
	// hidden and both panes show side by side as before.
	export let tabs = [];
	export let active;
</script>

<div class="pane-tabs flex-none border-b border-surface-300-600-token bg-surface-50 text-xs dark:bg-surface-900" role="tablist">
	{#each tabs as tab}
		<button
			type="button"
			role="tab"
			aria-selected={active === tab.id}
			class="flex-1 px-3 py-2 font-semibold {active === tab.id
				? 'border-b-2 border-primary-500'
				: 'border-b-2 border-transparent opacity-60'}"
			on:click={() => (active = tab.id)}>{tab.label}</button
		>
	{/each}
</div>

<style>
	/* Hidden but on a narrow mobile screen (below). */
	:global(.pane-tabs) {
		display: none;
	}
	/* The mobile layout (html.mobile, lib/platform.js). The selectors are
	   global, as app.css's shared mobile rules are, so they weigh the same
	   against Skeleton's and Tailwind's classes. */
	@media (max-width: 40rem) {
		:global(html.mobile .pane-tabs) {
			display: flex;
		}
		:global(html.mobile .pane-off) {
			display: none !important;
		}
	}
</style>
