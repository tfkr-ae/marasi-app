<script>
	// What a record needs before the report: the required items, with "3/4"
	// or "done" on their heading, then the optional ones, where an unset
	// item reads "Not set" without a warning. Every row is one height. A
	// missing item has a filled Add or Link, a filled one a quiet edit icon;
	// either opens the item's inline fix under its row. Text cut short at two
	// lines expands in place, read-only, from a click on it or its chevron.
	import { createEventDispatcher } from "svelte";
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import { AlertTriangle, Check, ChevronDown, ChevronUp, CircleDashed, Pencil } from "lucide-svelte";
	import { primaryVariant } from "../launchpad/format.js";
	import InlineFix from "./InlineFix.svelte";
	import { SEVERITY_BADGE } from "./severityColors.js";
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

	/** The item read in full, or null; one at a time, and none on another record. */
	let expanded = null;
	/** Items whose text runs past two lines. */
	let clipped = {};
	let shownID = record?.ID;
	$: if (String(record?.ID) !== String(shownID)) {
		shownID = record?.ID;
		expanded = null;
		clipped = {};
	}
	$: if (expanded && expanded === fixing) expanded = null;

	function toggle(key) {
		expanded = expanded === key ? null : key;
	}

	// Watches a clamped paragraph and marks its item when the text overflows.
	function clamp(node, key) {
		let current = key;
		const measure = () => {
			if (expanded === current) return;
			const over = node.scrollHeight > node.clientHeight + 1;
			if (!!clipped[current] !== over) clipped = { ...clipped, [current]: over };
		};
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		measure();
		return {
			update(next) {
				current = next;
				measure();
			},
			destroy: () => observer.disconnect(),
		};
	}

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
			<div class="mb-1.5 flex items-center gap-2 text-3xs font-bold uppercase tracking-wider">
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
					<div class={item.key === fixing ? "bg-primary-500/5 shadow-[inset_3px_0_0] shadow-primary-500" : ""}>
					<div
						data-item={item.key}
						data-focused={item.key === fixing || undefined}
						class="checklist-row grid {expanded === item.key ? 'min-h-12' : 'h-12'} grid-cols-[9.375rem_minmax(0,1fr)_auto] items-center gap-3 px-3"
					>
						<div class="flex items-center gap-2 text-2xs font-semibold {expanded === item.key ? 'self-start pt-4' : ''}">
							{#if item.done}<Check size={13} class="flex-none text-success-600 dark:text-success-500" />
							{:else if item.required}<AlertTriangle size={13} class="flex-none text-warning-800 dark:text-warning-500" />
							{:else}<CircleDashed size={12} class="flex-none opacity-40" />{/if}
							<span class="whitespace-nowrap">{item.label}</span>
						</div>
						<div class="min-w-0">
							{#if !item.done}
								<p class="text-2xs {item.required ? 'font-semibold text-warning-800 dark:text-warning-400' : 'opacity-50'}">
									{item.required ? "Missing" : "Not set"}
								</p>
							{:else if item.key === "CVSSVector"}
								<p class="flex items-center gap-2 text-xs">
									<b class="tabular-nums">{Number(record.CVSSScore).toFixed(1)}</b>
									<!-- The record's own severity, as its header shows. -->
									{#if record.Severity}<span
											class="badge px-1.5 py-0.5 text-3xs font-bold {SEVERITY_BADGE[record.Severity] ?? 'variant-soft'}"
											>{record.Severity}</span
										>{/if}
									<code class="min-w-0 truncate bg-transparent p-0 font-mono text-2xs opacity-70" title={record.CVSSVector}
										>{record.CVSSVector.replace("CVSS:3.1/", "")}</code
									>
								</p>
							{:else if expanded === item.key}
								<p class="whitespace-pre-wrap break-words py-3 text-xs leading-relaxed" data-expanded={item.key}>{value}</p>
							{:else if clipped[item.key]}
								<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-noninteractive-element-interactions -->
								<p
									class="line-clamp-2 cursor-pointer whitespace-pre-line text-xs leading-snug"
									title="Click to read in full"
									use:clamp={item.key}
									on:click={() => toggle(item.key)}
								>
									{value}
								</p>
							{:else}
								<p class="line-clamp-2 whitespace-pre-line text-xs leading-snug" use:clamp={item.key}>{value}</p>
							{/if}
						</div>
						<div class="flex w-16 items-center justify-end gap-0.5 {expanded === item.key ? 'self-start pt-2.5' : ''}">
							{#if item.done && (clipped[item.key] || expanded === item.key) && fixing !== item.key}
								<button
									type="button"
									class="p-1 opacity-50 hover:opacity-100"
									title={expanded === item.key ? "Collapse" : "Expand"}
									aria-label="{expanded === item.key ? 'Collapse' : 'Expand'} {item.label.toLowerCase()}"
									aria-expanded={expanded === item.key}
									data-expand={item.key}
									on:click={() => toggle(item.key)}
									>{#if expanded === item.key}<ChevronUp size={12} />{:else}<ChevronDown size={12} />{/if}</button
								>
							{/if}
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
										class="btn btn-sm px-2.5 py-0.5 text-2xs {primary}"
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
					</div>
				{/each}
			</div>
		</div>
	{/each}
</div>

<style>
	/* The mobile layout (html.mobile, lib/platform.js). The selectors are
	   global, as app.css's shared mobile rules are, so they weigh the same
	   against Skeleton's and Tailwind's classes. */
	/* The Logbook record view on a narrow mobile screen: the title takes its own
	   row above Back and the actions, and a checklist row puts its value
	   under the label, at full width, with its button beside the label. */
	@media (max-width: 40rem) {
		:global(html.mobile .checklist-row) {
			grid-template-columns: minmax(0, 1fr) auto;
			height: auto;
			min-height: 3rem;
			row-gap: 0.25rem;
			padding-top: 0.5rem;
			padding-bottom: 0.5rem;
		}
		:global(html.mobile .checklist-row > :nth-child(2)) {
			grid-column: 1 / -1;
			grid-row: 2;
		}
		:global(html.mobile .checklist-row > :nth-child(2):empty) {
			display: none;
		}
	}
</style>
