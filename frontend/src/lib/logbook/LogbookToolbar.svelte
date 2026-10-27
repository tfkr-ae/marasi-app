<script>
	// The Logbook toolbar, built like the Ledger's: a borderless search of
	// fixed width, the Findings and Test cases toggles, the Severity,
	// Category and Tags menus (the Ledger's ToolbarMenu, each of fixed
	// width), and Export at the far end. A filter that doesn't apply to the
	// kind on show is disabled in place, and a pressed toggle changes its
	// background only, so nothing here moves as the filters change.
	import { Folder, Hash, Search, ShieldAlert, SquareArrowRight, X } from "lucide-svelte";
	import ToolbarMenu from "../ledger/ToolbarMenu.svelte";
	import OptionList from "./OptionList.svelte";
	import { SEVERITY_MARK } from "./severity.js";
	import { SEVERITIES, severityCountsOf, testCaseCountsOf } from "../../stores/logbookStore";

	export let store;
	export let onExport = () => {};
	export let exportDisabled = false;
	export let searchInput = null;

	$: filters = $store.filters;
	$: severityCounts = severityCountsOf($store);
	$: severityOptions = SEVERITIES.map((s) => ({ value: s, count: severityCounts[s], mark: SEVERITY_MARK[s] }));
	$: testCaseCounts = testCaseCountsOf($store);
	$: active =
		filters.q !== "" ||
		filters.kind !== "all" ||
		filters.severities.length > 0 ||
		filters.categories.length > 0 ||
		filters.tags.length > 0 ||
		filters.status !== "all";

	// One value shows by name, several by their number.
	const badge = (values) => (values.length === 1 ? values[0] : values.length ? String(values.length) : "");
	const item = "flex flex-none items-center gap-1.5 whitespace-nowrap border-l border-surface-300-600-token px-3 text-sm";

	function onSearchKeydown(event) {
		if (event.key === "Escape") {
			event.stopPropagation();
			searchInput?.blur();
		}
	}
</script>

<div
	class="logbook-toolbar relative flex min-h-11 flex-none items-stretch border-b border-surface-300-600-token bg-surface-50 dark:bg-surface-900"
>
	<div class="flex w-64 flex-none items-center gap-2 pl-3 pr-2">
		<Search size={15} class="shrink-0 opacity-70" />
		<input
			id="logbookSearch"
			bind:this={searchInput}
			class="h-8 min-w-0 flex-1 border-0 bg-transparent p-0 text-xs focus:ring-0"
			placeholder="Search"
			aria-label="Search the Logbook"
			value={filters.q}
			on:input={(e) => store.setQuery(e.currentTarget.value)}
			on:keydown={onSearchKeydown}
		/>
		{#if active}
			<button
				id="logbookClearFilters"
				class="flex-none opacity-70 hover:opacity-100"
				title="Clear search and filters"
				aria-label="Clear search and filters"
				on:click={() => store.clearFilters()}><X size={15} /></button
			>
		{/if}
	</div>
	{#each [["findings", "Findings"], ["testCases", "Test cases"]] as [kind, label]}
		{@const on = filters.kind === kind}
		<button
			id="logbookKind-{kind}"
			class="{item} {on ? 'bg-surface-200-700-token' : 'hover:bg-surface-200-700-token'}"
			aria-pressed={on}
			on:click={() => store.setKind(on ? "all" : kind)}>{label}</button
		>
	{/each}
	<ToolbarMenu
		id="logbookSeverity"
		label="Severity"
		icon={ShieldAlert}
		title="Findings by severity"
		badge={badge(filters.severities)}
		widthClass="w-48 flex-none"
		panelClass="w-56"
		disabled={filters.kind === "testCases"}
	>
		<OptionList options={severityOptions} selected={filters.severities} onChange={store.setSeverities} />
	</ToolbarMenu>
	<ToolbarMenu
		id="logbookCategory"
		label="Category"
		icon={Folder}
		title="Test cases by category"
		badge={badge(filters.categories)}
		widthClass="w-48 flex-none"
		panelClass="w-60"
		disabled={filters.kind === "findings"}
	>
		<OptionList options={testCaseCounts.categories} selected={filters.categories} onChange={store.setCategories} />
	</ToolbarMenu>
	<ToolbarMenu
		id="logbookTags"
		label="Tags"
		icon={Hash}
		title="Test cases by tag"
		badge={badge(filters.tags)}
		widthClass="w-40 flex-none"
		panelClass="w-52"
		disabled={filters.kind === "findings"}
	>
		<OptionList options={testCaseCounts.tags} selected={filters.tags} mono onChange={store.setTags} />
	</ToolbarMenu>
	<span class="flex-1 border-l border-surface-300-600-token"></span>
	<button
		id="logbookExport"
		class="{item} {exportDisabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-surface-200-700-token'}"
		disabled={exportDisabled}
		on:click={onExport}><SquareArrowRight size={15} class="opacity-70" />Export</button
	>
</div>
