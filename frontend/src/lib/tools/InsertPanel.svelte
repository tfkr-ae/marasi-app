<script>
	// A tool page's Insert panel, styled like the Logbook outline, with the
	// Ledger's and Logbook's colours. Excalidraw takes traffic, findings and
	// test cases (click a row to add it, or drag it onto the canvas);
	// CyberChef takes traffic only (`kinds={["pair"]}`), where a click inserts
	// the request and `onPickResponse` adds a Res button for the response.
	//
	// onPick(source, row) gets { kind, id } and the pair's row or the record.
	// A dragged row carries its source as JSON under DRAG_TYPE (cards.js).
	import { onDestroy } from "svelte";
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import { Search, X } from "lucide-svelte";
	import { logbookStore } from "../../stores/logbookStore.js";
	import { highlightPalette } from "../../stores/highlightsStore.js";
	import { METHOD_CLASS, primaryVariant, statusClass, tertiaryVariant } from "../launchpad/format.js";
	import { SEVERITY_BADGE } from "../logbook/severityColors.js";
	import { formatSize, rowHighlight } from "../ledger/table.js";
	import { DRAG_TYPE } from "./cards.js";
	import { trafficList } from "./toolItems.js";

	export let kinds = ["pair", "finding", "testCase"];
	export let title = "Insert";
	export let hint = kinds.length > 1 ? "click to add · drag to place" : "click for the request";
	export let onPick = (_source, _row) => {};
	/** Set for a Res button on each pair row. */
	export let onPickResponse = null;
	export let onClose = null;

	const stop = trafficList.start();
	onDestroy(stop);

	let tab = kinds[0];
	let filter = "";
	let query = $trafficList.query;
	let flashed = null;

	$: primary = primaryVariant($modeCurrent);
	$: needle = filter.trim().toLowerCase();
	$: findings = $logbookStore.findings.filter((f) => (f.Title ?? "").toLowerCase().includes(needle));
	$: testCases = $logbookStore.testCases.filter((t) => (t.Title ?? "").toLowerCase().includes(needle));
	$: tabs = [
		["pair", "Traffic", $trafficList.pairs.length],
		["finding", "Findings", $logbookStore.findings.length],
		["testCase", "Test cases", $logbookStore.testCases.length],
	].filter(([kind]) => kinds.includes(kind));
	$: findingCount = (id) => $logbookStore.findings.filter((f) => String(f.TestCaseID) === String(id)).length;
	$: draggable = kinds.length > 1;

	function pick(source, row) {
		onPick(source, row);
		flashed = `${source.kind}:${source.id}`;
		setTimeout(() => (flashed = null), 600);
	}

	const dragStart = (source, row) => (event) => {
		event.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ source, last: source.kind === "pair" ? row : null }));
		event.dataTransfer.effectAllowed = "copy";
	};

	const onKey = (source, row) => (event) => {
		if (event.key === "Enter") pick(source, row);
	};

	const rowClass = (key) =>
		`relative cursor-pointer border-b border-surface-500/10 py-1.5 pl-3 pr-2 hover:bg-surface-200/70 dark:hover:bg-surface-700/60 ${
			flashed === key ? "bg-primary-500/20" : ""
		}`;
</script>

<div class="flex h-full min-h-0 flex-col text-xs" data-testid="insert-panel">
	<header class="flex-none space-y-2 border-b border-surface-500/30 p-3">
		<div class="flex items-baseline gap-2">
			<h2 class="text-sm font-bold">{title}</h2>
			<span class="text-2xs opacity-50">{hint}</span>
			<div class="flex-1"></div>
			{#if onClose}
				<button type="button" class="opacity-60 hover:opacity-100" title="Close" aria-label="Close" on:click={onClose}
					><X size={14} /></button
				>
			{/if}
		</div>
		{#if tabs.length > 1}
			<div class="flex text-2xs" role="tablist" aria-label="Kind">
				{#each tabs as [kind, label, count]}
					<button
						type="button"
						role="tab"
						class="flex-1 whitespace-nowrap px-2 py-1 {tab === kind ? primary : 'hover:bg-surface-500/10'}"
						aria-selected={tab === kind}
						data-testid="insert-tab-{kind}"
						on:click={() => (tab = kind)}>{label} <span class="opacity-70">{count}</span></button
					>
				{/each}
			</div>
		{/if}
		<div class="input-group input-group-divider h-8 grid-cols-[auto_1fr]">
			<div class="input-group-shim px-2"><Search size={13} /></div>
			{#if tab === "pair"}
				<input
					class="font-mono text-xs"
					placeholder={'Query, e.g. host = "api"'}
					aria-label="Traffic query"
					data-testid="insert-query"
					bind:value={query}
					on:input={() => trafficList.setQuery(query)}
				/>
			{:else}
				<input class="text-xs" placeholder="Filter by title" aria-label="Filter by title" data-testid="insert-filter" bind:value={filter} />
			{/if}
		</div>
		{#if tab === "pair" && $trafficList.error}<p class="text-2xs text-error-500">{$trafficList.error}</p>{/if}
	</header>
	<ul class="lp-scroll min-h-0 flex-1 overflow-auto pb-16" data-testid="insert-rows">
		{#if tab === "pair"}
			{#each $trafficList.pairs as pair (pair.ID)}
				{@const source = { kind: "pair", id: pair.ID }}
				{@const color = rowHighlight(pair, $highlightPalette)}
				<li
					class="flex items-center gap-2 {rowClass(`pair:${pair.ID}`)}"
					style={color ? `box-shadow: inset 3px 0 0 ${color}; background-color: ${color}22;` : ""}
					{draggable}
					role="option"
					aria-selected="false"
					tabindex="0"
					data-testid="insert-row"
					on:dragstart={dragStart(source, pair)}
					on:click={() => pick(source, pair)}
					on:keydown={onKey(source, pair)}
				>
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2 font-mono">
							<span class="w-7 shrink-0 text-right tabular-nums opacity-50">{pair.Number}</span>
							<span class="shrink-0 font-semibold {METHOD_CLASS[pair.Method] ?? ''}">{pair.Method}</span>
							<span class="min-w-0 flex-1 truncate" title={pair.Path}>{pair.Path}</span>
						</div>
						<div class="flex items-center gap-2 pl-9 text-2xs">
							<span class="min-w-0 flex-1 truncate opacity-60">{pair.Host}</span>
							<span class="shrink-0 font-mono opacity-60">{formatSize(pair.Length)}</span>
							<span class="w-7 shrink-0 text-right font-mono font-semibold {statusClass(pair.StatusCode)}"
								>{pair.StatusCode > 0 ? pair.StatusCode : "…"}</span
							>
						</div>
					</div>
					{#if onPickResponse}
						<button
							type="button"
							class="shrink-0 rounded-none px-1.5 py-0.5 text-2xs opacity-70 hover:bg-surface-500/20 hover:opacity-100"
							title="Insert the response"
							on:click|stopPropagation={() => onPickResponse(source, pair)}>Res</button
						>
					{/if}
				</li>
			{:else}
				<li class="px-3 py-2 opacity-60">{$trafficList.loading ? "Loading…" : "No traffic"}</li>
			{/each}
		{:else if tab === "finding"}
			{#each findings as finding (finding.ID)}
				{@const source = { kind: "finding", id: finding.ID }}
				<li
					class="flex flex-col gap-0.5 {rowClass(`finding:${finding.ID}`)}"
					{draggable}
					role="option"
					aria-selected="false"
					tabindex="0"
					data-testid="insert-row"
					on:dragstart={dragStart(source, finding)}
					on:click={() => pick(source, finding)}
					on:keydown={onKey(source, finding)}
				>
					<div class="flex items-center gap-2">
						<span class="badge shrink-0 rounded-none px-1.5 py-0 text-3xs font-bold {SEVERITY_BADGE[finding.Severity] ?? 'variant-soft'}"
							>{finding.Severity || "No severity"}</span
						>
						<span class="min-w-0 flex-1 truncate font-semibold">{finding.Title || "Untitled finding"}</span>
					</div>
					<div class="text-2xs opacity-60">
						{#if finding.CVSSScore}CVSS {Number(finding.CVSSScore).toFixed(1)} · {/if}{finding.Requests?.length ?? 0} pairs · {finding
							.Artifacts?.length ?? 0} artifacts
					</div>
				</li>
			{:else}
				<li class="px-3 py-2 opacity-60">No findings</li>
			{/each}
		{:else}
			{#each testCases as testCase (testCase.ID)}
				{@const source = { kind: "testCase", id: testCase.ID }}
				<li
					class="flex flex-col gap-0.5 {rowClass(`testCase:${testCase.ID}`)}"
					{draggable}
					role="option"
					aria-selected="false"
					tabindex="0"
					data-testid="insert-row"
					on:dragstart={dragStart(source, testCase)}
					on:click={() => pick(source, testCase)}
					on:keydown={onKey(source, testCase)}
				>
					<div class="flex items-center gap-2">
						{#if testCase.Category}<span class="badge shrink-0 rounded-none px-1.5 py-0 text-3xs font-bold {tertiaryVariant($modeCurrent)}"
								>{testCase.Category}</span
							>{/if}
						<span class="min-w-0 flex-1 truncate font-semibold">{testCase.Title || "Untitled test case"}</span>
					</div>
					<div class="text-2xs opacity-60">
						{#each (testCase.Tags ?? []).slice(0, 3) as tag}<span class="mr-1">#{tag}</span>{/each}{testCase.Requests?.length ?? 0} pairs
						· {findingCount(testCase.ID)} findings
					</div>
				</li>
			{:else}
				<li class="px-3 py-2 opacity-60">No test cases</li>
			{/each}
		{/if}
	</ul>
</div>
