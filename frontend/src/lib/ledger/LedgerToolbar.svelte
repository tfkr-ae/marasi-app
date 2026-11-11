<script>
	// The Ledger's toolbar: the query box with its status and the Live button, the saved queries, Highlights, Marks and Types menus, and the query fields panel.
	import { getToastStore, modeCurrent } from "@skeletonlabs/skeleton";
	import { Search, X, LoaderCircle, CircleHelp, CircleAlert, TriangleAlert, Tags, Highlighter } from "lucide-svelte";
	import QueryFieldList from "../components/QueryFieldList.svelte";
	import LedgerQueryBox from "./LedgerQueryBox.svelte";
	import SavedQueriesMenu from "./SavedQueriesMenu.svelte";
	import { readyMadeQueries } from "../../stores/savedQueriesStore";
	import { appendToQuery } from "../ledgerQueryFields";
	import ToolbarMenu from "./ToolbarMenu.svelte";
	import MarksMenu from "./MarksMenu.svelte";
	import HighlightsMenu from "./HighlightsMenu.svelte";
	import { activeHighlightCount } from "./highlights.js";
	import { activeMarkCount } from "./marks.js";
	import { highlightCounts, markCounts } from "../../stores/ledgerMenuCounts.js";
	import LedgerTypesMenu from "./LedgerTypesMenu.svelte";
	import { primaryVariant } from "../launchpad/format.js";
	import { highlightPalette, renameHighlight } from "../../stores/highlightsStore";
	import { select } from "../storeSelect.js";
	import { toastError as showError } from "../toasts.js";
	import {
		ledgerStore,
		isQueryActive,
		isLiveNewestFirst,
		indexWarning,
		countLabel,
	} from "../../stores/ledgerStore";

	// True while the table shows ghost rows; the match count reads "Querying…".
	export let ghostRows = false;

	const query = select(ledgerStore, (state) => state.query);
	const queryText = select(ledgerStore, (state) => state.queryText);
	const queryPending = select(ledgerStore, (state) => state.queryPending);
	const querying = select(ledgerStore, (state) => state.querying);
	const queryActive = select(ledgerStore, (state) => isQueryActive(state.query));
	const statusCount = select(ledgerStore, countLabel);
	const indexNote = select(ledgerStore, indexWarning);
	// The live view: no query typed or running, newest first.
	const inLiveView = select(ledgerStore, (state) => isLiveNewestFirst(state) && !state.queryText);

	const toastStore = getToastStore();
	const toastError = (message, error) => showError(toastStore, message, error);

	// Whether the query box shows the whole query, wrapped.
	let queryExpanded = false;
	let queryFieldsOpen = false;
	let typesMenu;

	$: primary = primaryVariant($modeCurrent);
	// Marasi's error for the text in the query box, underlined there; an
	// error for text since edited is stale.
	$: queryBoxError = $query.error?.query === $queryText ? $query.error : null;

	/** Opens or closes the query fields panel. */
	export function toggleQueryFields() {
		queryFieldsOpen = !queryFieldsOpen;
	}

	/** Focuses the Types menu's find box. */
	export function focusExclusion() {
		typesMenu?.focusFind();
	}

	// Appends a field-list example to the query box and runs it like typing.
	function insertQueryExample(example) {
		const text = appendToQuery($queryText, example);
		ledgerStore.setQueryText(text);
		ledgerStore.scheduleQuery(text);
		document.getElementById("searchBox")?.focus();
	}

	$: activeMarks = activeMarkCount($queryText);
	$: activeHighlights = activeHighlightCount($queryText);

	function onRenameHighlight({ number, label, allProjects }) {
		renameHighlight(number, label, { allProjects }).catch((error) =>
			toastError(`Failed to rename highlight ${number}`, error),
		);
	}

	// Closes the toolbar's panels on a click outside them.
	function onWindowPointerDown(event) {
		if (queryFieldsOpen && !event.target.closest?.(".ledger-query-fields, #ledgerQueryFieldsToggle")) {
			queryFieldsOpen = false;
		}
	}
</script>

<svelte:window on:pointerdown={onWindowPointerDown} />

<!-- Toolbar: the query box, then the menus. -->
<div
	class="ledger-toolbar relative flex min-h-11 flex-none items-stretch border-b border-surface-300-600-token bg-surface-50 dark:bg-surface-900"
>
	<!-- The search area: the query box and the Live indicator. The
	     ready-made queries span it. -->
	<div class="ledger-search flex min-w-0 flex-1 items-stretch">
		<!-- An expanded query wraps, and the toolbar grows to show it all. -->
		<div class="flex min-w-0 flex-1 gap-2 pl-3 {queryExpanded ? 'items-start py-3' : 'items-center'}">
			{#if $queryPending || $querying}
				<span
					class="ledger-querying flex shrink-0"
					title="Querying Marasi…"
					role="status"
					aria-label="Querying Marasi"><LoaderCircle size={15} class="animate-spin opacity-70" /></span
				>
			{:else}
				<Search size={15} class="shrink-0 opacity-70" />
			{/if}
			<LedgerQueryBox
				bind:expanded={queryExpanded}
				value={$queryText}
				error={queryBoxError}
				readyMade={$readyMadeQueries}
				on:change={(e) => {
					ledgerStore.setQueryText(e.detail);
					ledgerStore.scheduleQuery(e.detail);
				}}
				on:run={() => ledgerStore.runQuery($queryText)}
			/>
			{#if queryBoxError}
				<span
					id="ledgerQueryError"
					class="flex max-w-[24rem] items-center gap-1 text-xs text-error-500"
					role="alert"
					title={queryBoxError.position
						? `Position ${queryBoxError.position}: ${queryBoxError.message}`
						: queryBoxError.message}
					><CircleAlert size={14} class="shrink-0" /><span class="truncate"
						>{queryBoxError.message}</span
					></span
				>
			{:else if $queryActive}
				<span id="ledgerQueryMatchCount" class="whitespace-nowrap text-xs opacity-70"
					>{ghostRows ? "Querying…" : $statusCount}</span
				>
				{#if $indexNote}
					<span
						id="ledgerIndexBuilding"
						class="flex items-center gap-1 whitespace-nowrap text-xs text-warning-800 dark:text-warning-400"
						role="status"
						title="Marasi is still indexing older pairs, so text matches may be missing"
						><TriangleAlert size={13} />{$indexNote}</span
					>
				{/if}
			{/if}
			{#if $queryText}
				<button
					id="ledgerQueryClear"
					type="button"
					class="opacity-70 hover:opacity-100"
					title="Clear query (Esc)"
					aria-label="Clear query"
					on:click={() => ledgerStore.clearQuery()}
				>
					<X size={15} />
				</button>
			{/if}
			<button
				id="ledgerQueryFieldsToggle"
				type="button"
				class="btn btn-sm px-2 {queryFieldsOpen ? primary : 'opacity-70 hover:opacity-100'}"
				title="Query fields"
				aria-label="Query fields"
				aria-expanded={queryFieldsOpen}
				aria-controls="ledgerQueryFields"
				on:click={() => (queryFieldsOpen = !queryFieldsOpen)}
			>
				<CircleHelp size={15} />
			</button>
		</div>
		{#if $inLiveView}
			<span
				id="ledgerLive"
				class="flex items-center gap-1.5 px-3 text-sm"
				title="The live view: every pair, newest first"
				><span class="h-2 w-2 rounded-full bg-success-500"></span>Live</span
			>
		{:else}
			<button
				id="ledgerLive"
				type="button"
				class="flex items-center gap-1.5 px-3 text-sm hover:bg-surface-200-700-token"
				title="Back to the live view: clears the query and the sort"
				on:click={() => ledgerStore.backToLive()}
				><span class="h-2 w-2 rounded-full bg-surface-400"></span>Live</button
			>
		{/if}
	</div>
	<SavedQueriesMenu
		queryText={$queryText}
		valid={$queryActive && !$queryPending && !queryBoxError && $query.ranQuery === $queryText}
		on:apply
	/>
	<ToolbarMenu
		id="ledgerHighlights"
		label="Highlights"
		icon={Highlighter}
		title="Pairs by highlight"
		badge={activeHighlights ? String(activeHighlights) : ""}
		panelClass="w-72"
		on:open={() => (highlightCounts.setOpen(true), highlightCounts.load())}
		on:close={() => highlightCounts.setOpen(false)}
	>
		<HighlightsMenu
			queryText={$queryText}
			counts={$highlightCounts}
			palette={$highlightPalette}
			on:toggle={(e) => ledgerStore.toggleQueryTerm(e.detail)}
			on:rename={(e) => onRenameHighlight(e.detail)}
		/>
	</ToolbarMenu>
	<ToolbarMenu
		id="ledgerMarks"
		label="Marks"
		icon={Tags}
		title="Pairs with a note or a link"
		badge={activeMarks ? String(activeMarks) : ""}
		panelClass="w-64"
		on:open={() => (markCounts.setOpen(true), markCounts.load())}
		on:close={() => markCounts.setOpen(false)}
	>
		<MarksMenu
			queryText={$queryText}
			counts={$markCounts}
			on:toggle={(e) => ledgerStore.toggleQueryTerm(e.detail)}
		/>
	</ToolbarMenu>
	<LedgerTypesMenu bind:this={typesMenu} />
	{#if queryFieldsOpen}
		<div
			id="ledgerQueryFields"
			class="ledger-query-fields absolute left-0 top-full z-40 max-h-[50vh] w-[40rem] max-w-[90%] overflow-auto border border-l-0 border-surface-300-600-token bg-surface-100-800-token p-3 shadow-xl"
		>
			<QueryFieldList on:insert={(e) => insertQueryExample(e.detail)} />
		</div>
	{/if}
</div>
