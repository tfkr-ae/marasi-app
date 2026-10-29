<script>
	// The Logbook's list: severity cards, then findings and test cases side
	// by side. A record missing a required item has a quiet mark that names
	// what is missing on hover. A severity card filters by severity (and
	// narrows to findings); the Test cases card narrows to test cases. Test
	// cases group as the outline groups them.
	import { AlertTriangle, BookCheck, ShieldAlert } from "lucide-svelte";
	import { SEVERITY_BADGE, SEVERITY_MARK } from "./severityColors.js";
	import {
		SEVERITIES,
		completenessOf,
		filteredOf,
		groupsOf,
		severityCountsOf,
	} from "../../stores/logbookStore";

	export let store;
	export let onOpen = (kind, id) => {};

	$: state = $store;
	$: filters = state.filters;
	$: listed = filteredOf(state);
	$: findings = listed.findings;
	$: testCases = listed.testCases;
	$: testCaseGroups = groupsOf(state).testCases;
	$: counts = severityCountsOf(state);
	$: testCaseById = new Map(state.testCases.map((t) => [t.ID, t]));
	$: findingsByTestCase = state.findings.reduce((byId, f) => {
		if (f.TestCaseID) byId.set(f.TestCaseID, [...(byId.get(f.TestCaseID) ?? []), f]);
		return byId;
	}, new Map());

	const missingOf = (kind, record) =>
		completenessOf(kind, record)
			.items.filter((item) => item.required && !item.done)
			.map((item) => item.label.toLowerCase());
	const rank = (f) => SEVERITIES.indexOf(f.Severity);

	function toggleSeverity(severity) {
		const on = filters.severities.includes(severity);
		store.setSeverities(on ? filters.severities.filter((s) => s !== severity) : [...filters.severities, severity]);
	}

	const card = (on, dim) =>
		`flex-1 py-2 text-center ring-1 transition-colors ${
			on ? "bg-primary-500/15 ring-primary-500/50" : "ring-surface-500/20 hover:bg-surface-200/50 dark:hover:bg-surface-800/60"
		} ${dim ? "opacity-40" : ""}`;
	const row =
		"flex h-9 w-full items-center gap-2 border-t border-surface-500/15 px-3 text-left hover:bg-surface-200/50 dark:hover:bg-surface-800/60";
</script>

<div class="logbook-summary h-full overflow-auto pb-20">
	<div class="space-y-5 px-5 py-4">
		{#if filters.kind !== "testCases"}
			<div class="flex gap-2">
				{#each SEVERITIES as severity}
					{@const on = filters.severities.includes(severity)}
					<button
						class="logbook-severity-card {card(on, filters.severities.length && !on)}"
						aria-pressed={on}
						on:click={() => toggleSeverity(severity)}
					>
						<div class="text-base font-bold tabular-nums">{counts[severity]}</div>
						<div class="flex items-center justify-center gap-1 text-[10px] opacity-70">
							<span class="h-2 w-2 rounded-sm {SEVERITY_MARK[severity]}"></span>{severity}
						</div>
					</button>
				{/each}
				{#if filters.kind === "all"}
					<button class="logbook-test-cases-card {card(false, false)}" on:click={() => store.setKind("testCases")}>
						<div class="text-base font-bold tabular-nums">{testCases.length}</div>
						<div class="text-[10px] opacity-70">Test cases</div>
					</button>
				{/if}
			</div>
		{/if}
		<div class="grid items-start gap-5 {findings.length && testCases.length ? 'xl:grid-cols-[3fr_2fr]' : ''}">
			{#if findings.length}
				<section class="logbook-summary-findings min-w-0 ring-1 ring-surface-500/20">
					<h2 class="flex h-9 items-center gap-2 px-3 text-sm font-bold">
						<ShieldAlert size={14} class="text-primary-500" />Findings
						<span class="text-[11px] font-normal opacity-60">{findings.length}</span>
					</h2>
					{#each findings as finding (finding.ID)}
						{@const missing = missingOf("finding", finding)}
						<button class={row} on:click={() => onOpen("finding", finding.ID)}>
							<span class="w-[86px] flex-none"
								><span
									class="badge rounded-sm px-1.5 py-0.5 text-[10px] font-bold {SEVERITY_BADGE[finding.Severity] ??
										'variant-soft'}">{finding.Severity || "None"}</span
								></span
							>
							<span class="min-w-0 flex-1 truncate text-xs font-semibold" title={finding.Title}>{finding.Title}</span>
							{#if missing.length}<span class="logbook-missing flex-none" title="Missing {missing.join(', ')}"
									><AlertTriangle size={12} class="text-warning-800 dark:text-warning-500" /></span
								>{/if}
							<span class="w-8 flex-none text-right font-mono text-[11px] tabular-nums opacity-80"
								>{finding.CVSSVector ? Number(finding.CVSSScore).toFixed(1) : ""}</span
							>
							<span class="w-[26%] flex-none truncate text-[11px] opacity-60"
								>{testCaseById.get(finding.TestCaseID)?.Title ?? ""}</span
							>
						</button>
					{/each}
				</section>
			{/if}
			{#if testCases.length}
				<section class="logbook-summary-test-cases min-w-0 ring-1 ring-surface-500/20">
					<h2 class="flex h-9 items-center gap-2 px-3 text-sm font-bold">
						<BookCheck size={14} class="text-tertiary-500" />Test cases
						<span class="text-[11px] font-normal opacity-60">{testCases.length}</span>
					</h2>
					{#each testCaseGroups as group (group.key)}
						{#if group.title !== null}
							<div
								class="flex h-7 items-center border-t border-surface-500/15 bg-surface-100/70 px-3 text-[11px] font-semibold opacity-80 dark:bg-surface-800/50 {state.grouping.testCases === 'tag' &&
								group.key !== '#none'
									? 'font-mono'
									: ''}"
							>
								{group.title}
							</div>
						{/if}
						{#each group.items as testCase (testCase.ID)}
							{@const missing = missingOf("testCase", testCase)}
							<button class={row} on:click={() => onOpen("testCase", testCase.ID)}>
								<span class="min-w-0 flex-1 truncate text-xs font-semibold" title={testCase.Title}
									>{testCase.Title}</span
								>
								{#if missing.length}<span class="logbook-missing flex-none" title="Missing {missing.join(', ')}"
										><AlertTriangle size={12} class="text-warning-800 dark:text-warning-500" /></span
									>{/if}
								<span class="w-[30%] flex-none truncate font-mono text-[11px] opacity-60"
									>{(testCase.Tags ?? []).join(" · ")}</span
								>
								<span class="flex w-14 flex-none justify-end gap-0.5"
									>{#each [...(findingsByTestCase.get(testCase.ID) ?? [])].sort((a, b) => rank(a) - rank(b)) as f (f.ID)}<span
											class="h-2.5 w-2.5 rounded-sm {SEVERITY_MARK[f.Severity] ?? 'bg-surface-400'}"
											title="{f.Severity}: {f.Title}"
										></span>{/each}</span
								>
							</button>
						{/each}
					{/each}
				</section>
			{/if}
		</div>
		{#if !findings.length && !testCases.length}
			<p class="py-16 text-center text-[11px] opacity-60">
				{state.findings.length + state.testCases.length ? "Nothing matches" : "No findings or test cases yet"}
			</p>
		{/if}
	</div>
</div>
