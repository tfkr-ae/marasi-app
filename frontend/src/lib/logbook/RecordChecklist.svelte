<script>
	// What a record needs before the report: the required items, with "3/4"
	// or "done" on their heading, then the optional ones, where an unset
	// item reads "Not set" without a warning. Every row is one height. A
	// missing item has a filled Add or Link, a filled one a quiet edit icon;
	// either opens the item's inline fix under its row.
	import { createEventDispatcher } from "svelte";
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import { AlertTriangle, Check, CircleDashed, Pencil } from "lucide-svelte";
	import { primaryVariant } from "../launchpad/format.js";
	import InlineFix from "./InlineFix.svelte";
	import { severityFromScore } from "../cvss.js";
	import { SEVERITY_BADGE } from "./severity.js";
	import { completenessOf } from "../../stores/logbookStore";

	/** "finding" or "testCase". */
	export let kind;
	export let record;
	/** Every test case, to name a finding's. */
	export let testCases = [];
	/** The Logbook store, for the inline fix. */
	export let store = null;
	/** The open inline fix, or null. */
	export let fix = null;

	const dispatch = createEventDispatcher();
	const LINKS = new Set(["Requests", "TestCaseID"]);
	$: primary = primaryVariant($modeCurrent);
	$: fixing = fix && fix.kind === kind && String(fix.id) === String(record.ID) ? fix.item : null;

	$: completeness = completenessOf(kind, record);
	$: groups = [
		["Required", completeness.items.filter((item) => item.required)],
		["Optional", completeness.items.filter((item) => !item.required)],
	].filter(([, items]) => items.length);
	$: cvssSeverity = severityFromScore(record.CVSSScore);

	function valueOf(key) {
		if (key === "Requests") {
			const n = (record.Requests ?? []).length;
			return `${n} ${n === 1 ? "request" : "requests"}`;
		}
		if (key === "TestCaseID") return testCases.find((t) => String(t.ID) === String(record.TestCaseID))?.Title ?? "";
		return record[key] ?? "";
	}
</script>

<div class="logbook-checklist space-y-4">
	{#each groups as [group, items] (group)}
		<div>
			<div class="mb-1.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider">
				<span class="opacity-50">{group}</span>
				{#if group === "Required"}
					{#if completeness.status === "done"}
						<span class="logbook-progress flex items-center gap-1 normal-case tracking-normal text-success-700 dark:text-success-400"
							><Check size={11} />done</span
						>
					{:else}
						<span class="logbook-progress normal-case tracking-normal text-warning-800 dark:text-warning-400"
							>{completeness.done}/{completeness.total}</span
						>
					{/if}
				{/if}
			</div>
			<div
				class="divide-y divide-surface-500/20 ring-1 {group === 'Optional' ? 'ring-surface-500/15' : 'ring-surface-500/25'}"
			>
				{#each items as item (item.key)}
					{@const value = valueOf(item.key)}
					<div
						data-item={item.key}
						data-focused={item.key === fixing || undefined}
						class="grid h-12 grid-cols-[150px_minmax(0,1fr)_auto] items-center gap-3 px-3 {item.key === fixing
							? 'bg-warning-500/10'
							: ''}"
					>
						<div class="flex items-center gap-2 text-[11px] font-semibold">
							{#if item.done}<Check size={13} class="flex-none text-success-600 dark:text-success-500" />
							{:else if item.required}<AlertTriangle size={13} class="flex-none text-warning-800 dark:text-warning-500" />
							{:else}<CircleDashed size={12} class="flex-none opacity-40" />{/if}
							<span class="whitespace-nowrap">{item.label}</span>
						</div>
						<div class="min-w-0">
							{#if !item.done}
								<p class="text-[11px] {item.required ? 'font-semibold text-warning-800 dark:text-warning-400' : 'opacity-50'}">
									{item.required ? "Missing" : "Not set"}
								</p>
							{:else if item.key === "CVSSVector"}
								<p class="flex items-center gap-2 text-xs">
									<b class="tabular-nums">{Number(record.CVSSScore).toFixed(1)}</b>
									{#if cvssSeverity}<span
											class="badge rounded-sm px-1.5 py-0.5 text-[10px] font-bold {SEVERITY_BADGE[cvssSeverity]}"
											>{cvssSeverity}</span
										>{/if}
									<code class="min-w-0 truncate bg-transparent p-0 font-mono text-[11px] opacity-70" title={record.CVSSVector}
										>{record.CVSSVector.replace("CVSS:3.1/", "")}</code
									>
								</p>
							{:else}
								<p class="line-clamp-2 whitespace-pre-line text-xs leading-snug" title={value}>{value}</p>
							{/if}
						</div>
						<div class="flex w-16 justify-end">
							{#if store && fixing !== item.key}
								{#if item.done}
									<button
										type="button"
										class="p-1 opacity-50 hover:opacity-100"
										title="Edit {item.label.toLowerCase()}"
										aria-label="Edit {item.label.toLowerCase()}"
										data-fix-open={item.key}
										on:click={() => store.startFix(item.key)}><Pencil size={12} /></button
									>
								{:else}
									<button
										type="button"
										class="btn btn-sm px-2.5 py-0.5 text-[11px] {primary}"
										data-fix-open={item.key}
										on:click={() => store.startFix(item.key)}>{LINKS.has(item.key) ? "Link" : "Add"}</button
									>
								{/if}
							{/if}
						</div>
					</div>
					{#if fixing === item.key}
						<InlineFix {store} {fix} {testCases} on:save={() => dispatch("save")} on:leave={() => dispatch("leave")} />
					{/if}
				{/each}
			</div>
		</div>
	{/each}
</div>
