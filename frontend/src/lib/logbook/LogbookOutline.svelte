<script>
	// The Logbook dock: the title with how many records show, + Finding and
	// + Test case, the status toggle, then an outline of the records the
	// filters list. Each section has its own grouping and expand or collapse
	// all; a group only folds, and a record opens.
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import {
		BookCheck,
		ChevronDown,
		ChevronRight,
		ChevronsDownUp,
		ChevronsUpDown,
		Plus,
		ShieldAlert,
	} from "lucide-svelte";
	import { primaryVariant } from "../launchpad/format.js";
	import GroupPicker from "./GroupPicker.svelte";
	import { SEVERITY_MARK } from "./severity.js";
	import { anyStatusOf, completenessOf, groupsOf } from "../../stores/logbookStore";

	export let store;
	export let onOpen = (kind, id) => {};
	export let onNewFinding = () => {};
	export let onNewTestCase = () => {};

	const FINDING_GROUPS = [
		["severity", "Severity"],
		["none", "No grouping"],
	];
	const TEST_CASE_GROUPS = [
		["category", "Category"],
		["tag", "Tag"],
		["none", "No grouping"],
	];

	// Folded groups, by section and group key.
	let closed = new Set();

	$: state = $store;
	$: primary = primaryVariant($modeCurrent);
	$: tertiary = $modeCurrent ? "variant-ghost-tertiary ring-0 shadow-none" : "variant-filled-tertiary";
	$: groups = groupsOf(state);
	$: any = anyStatusOf(state);
	$: anyList = [
		...any.findings.map((r) => completenessOf("finding", r).status),
		...any.testCases.map((r) => completenessOf("testCase", r).status),
	];
	$: statusCounts = {
		all: anyList.length,
		progress: anyList.filter((s) => s === "progress").length,
		done: anyList.filter((s) => s === "done").length,
	};
	$: shown =
		state.filters.status === "all" ? statusCounts.all : statusCounts[state.filters.status];
	$: total = state.findings.length + state.testCases.length;
	$: sections = [
		{
			key: "findings",
			title: "Findings",
			icon: ShieldAlert,
			kind: "finding",
			by: state.grouping.findings,
			options: FINDING_GROUPS,
			groups: groups.findings,
		},
		{
			key: "testCases",
			title: "Test cases",
			icon: BookCheck,
			kind: "testCase",
			by: state.grouping.testCases,
			options: TEST_CASE_GROUPS,
			groups: groups.testCases,
		},
	]
		.map((s) => ({ ...s, count: new Set(s.groups.flatMap((g) => g.items.map((r) => r.ID))).size }))
		.filter((s) => s.count);

	const groupKey = (section, group) => `${section.key}:${group.key}`;
	const sectionOpen = (section, closed) => section.groups.some((g) => !closed.has(groupKey(section, g)));

	function toggleSection(section) {
		const next = new Set(closed);
		const open = sectionOpen(section, closed);
		for (const g of section.groups) open ? next.add(groupKey(section, g)) : next.delete(groupKey(section, g));
		closed = next;
	}

	function toggleGroup(key) {
		const next = new Set(closed);
		next.has(key) ? next.delete(key) : next.add(key);
		closed = next;
	}

	const isOpenRecord = (kind, id) => state.open?.kind === kind && state.open?.id === id;
</script>

<div class="logbook-outline flex h-full min-h-0 flex-col text-xs">
	<header class="flex-none space-y-2 border-b border-surface-500/30 p-3">
		<div class="flex items-baseline gap-2 pr-5">
			<h2 class="text-sm font-bold">Logbook</h2>
			<span id="logbookShown" class="text-[11px] opacity-50">{shown} of {total} shown</span>
		</div>
		<div class="flex gap-2">
			<button id="logbookNewFinding" class="btn btn-sm flex-1 {primary}" on:click={onNewFinding}
				><Plus size={14} class="mr-1" />Finding</button
			>
			<button id="logbookNewTestCase" class="btn btn-sm flex-1 {tertiary}" on:click={onNewTestCase}
				><Plus size={14} class="mr-1" />Test case</button
			>
		</div>
		<div class="logbook-status flex text-[11px]" role="group" aria-label="Status">
			{#each [["all", "All"], ["progress", "In progress"], ["done", "Done"]] as [status, label]}
				<button
					class="flex-1 px-2 py-1 {state.filters.status === status
						? primary
						: 'bg-surface-200 hover:bg-surface-300 dark:bg-surface-700 dark:hover:bg-surface-600'}"
					aria-pressed={state.filters.status === status}
					on:click={() => store.setStatus(status)}>{label} <span class="opacity-70">{statusCounts[status]}</span></button
				>
			{/each}
		</div>
	</header>
	<div class="lp-scroll min-h-0 flex-1 overflow-auto pb-16" role="tree">
		{#each sections as section (section.key)}
			{@const open = sectionOpen(section, closed)}
			<div
				class="sticky top-0 z-10 flex h-8 items-center gap-2 border-b border-surface-500/20 bg-surface-100 pl-3 pr-2 text-[11px] font-semibold dark:bg-surface-800"
			>
				<svelte:component this={section.icon} size={12} class="opacity-60" />
				<span>{section.title}</span>
				<span class="flex-1 font-normal opacity-60">{section.count}</span>
				<GroupPicker
					options={section.options}
					value={section.by}
					onChange={(by) => store.setGrouping(section.key, by)}
				/>
				<button
					class="p-1 opacity-60 hover:opacity-100 {section.by === 'none' ? 'invisible' : ''}"
					title={open ? "Collapse all" : "Expand all"}
					aria-label={open ? `Collapse all ${section.title.toLowerCase()}` : `Expand all ${section.title.toLowerCase()}`}
					on:click={() => toggleSection(section)}
				>
					{#if open}<ChevronsDownUp size={13} />{:else}<ChevronsUpDown size={13} />{/if}
				</button>
			</div>
			{#each section.groups as group (group.key)}
				{@const key = groupKey(section, group)}
				{@const groupOpen = group.title === null || !closed.has(key)}
				{#if group.title !== null}
					<button
						class="flex h-8 w-full items-center gap-2 pl-2 pr-3 text-left hover:bg-surface-200/70 dark:hover:bg-surface-700/60"
						aria-expanded={groupOpen}
						on:click={() => toggleGroup(key)}
					>
						{#if groupOpen}<ChevronDown size={12} class="flex-none opacity-60" />{:else}<ChevronRight
								size={12}
								class="flex-none opacity-60"
							/>{/if}
						{#if section.by === "severity"}<span class="h-2.5 w-2.5 flex-none rounded-sm {SEVERITY_MARK[group.key]}"
							></span>{/if}
						<span class="min-w-0 flex-1 truncate {section.by === 'tag' && group.key !== '#none' ? 'font-mono text-[11px]' : ''}"
							>{group.title}</span
						><span class="text-[11px] opacity-60">{group.items.length}</span>
					</button>
				{/if}
				{#if groupOpen}
					{#each group.items as record (record.ID)}
						{@const on = isOpenRecord(section.kind, record.ID)}
						<button
							class="relative flex h-7 w-full items-center gap-2 {group.title === null
								? 'pl-4'
								: 'pl-9'} pr-3 text-left text-[11px] {on
								? 'bg-primary-500/20'
								: 'hover:bg-surface-200/70 dark:hover:bg-surface-700/60'}"
							aria-current={on ? "true" : undefined}
							on:click={() => onOpen(section.kind, record.ID)}
						>
							{#if on}<span class="absolute bottom-0 left-0 top-0 w-[3px] bg-primary-500"></span>{/if}
							{#if group.title === null && section.kind === "finding"}<span
									class="h-2 w-2 flex-none rounded-sm {SEVERITY_MARK[record.Severity] ?? 'bg-surface-400'}"
									title={record.Severity}
								></span>{/if}
							<span class="min-w-0 flex-1 truncate">{record.Title}</span>
							{#if completenessOf(section.kind, record).status !== "done"}<span
									class="h-1.5 w-1.5 flex-none rounded-full bg-warning-500"
									title="In progress"
								></span>{/if}
						</button>
					{/each}
				{/if}
			{/each}
		{:else}
			<p class="p-8 text-center text-[11px] opacity-60">{total ? "Nothing matches" : "Nothing yet"}</p>
		{/each}
	</div>
</div>
