<script>
	// A finding's test case, or a test case's findings, each folding open to
	// read in place, with Open to go to it. A test case also has + Finding,
	// a new finding linked to it.
	import { getModalStore } from "@skeletonlabs/skeleton";
	import { BookCheck, ChevronDown, ChevronRight, CornerDownRight, Plus } from "lucide-svelte";
	import { SEVERITY_BADGE } from "./severityColors.js";
	import { completenessOf, logbookStore } from "../../stores/logbookStore";
	import { newRecord } from "./recordEditor.js";

	/** The open record's kind: "finding" or "testCase". */
	export let kind;
	/** [{ kind, record }], from linkedOf. */
	export let links = [];
	/** Two columns when there is room. */
	export let wide = false;
	export let onOpen = (kind, id) => {};

	let unfolded = new Set();
	const toggle = (id) => {
		const next = new Set(unfolded);
		next.has(id) ? next.delete(id) : next.add(id);
		unfolded = next;
	};

	const fieldsOf = (link) =>
		link.kind === "finding"
			? [
					["Writeup", link.record.WriteUp],
					["Treatment plan", link.record.TreatmentPlan],
				]
			: [
					["Description", link.record.Description],
					["Note", link.record.Note],
				];
	const heading = "mb-1 text-[10px] font-bold uppercase tracking-wider opacity-50";

	const modalStore = getModalStore();
	// The test case these are listed under is the one open in the workspace.
	const newFinding = () => newRecord(modalStore, "finding", { testCaseId: $logbookStore.open?.id ?? null });
</script>

<div class="logbook-linked">
	<div class="flex items-start gap-2">
		<h2 class="{heading} flex flex-1 gap-2">
			<span>{kind === "finding" ? "Test case" : "Findings"}</span>
			{#if kind === "testCase"}<span class="font-normal">{links.length}</span>{/if}
		</h2>
		{#if kind === "testCase"}
			<button
				type="button"
				class="-mt-0.5 flex flex-none items-center gap-1 px-1 text-xs opacity-70 hover:opacity-100"
				title="New finding for this test case"
				data-new-finding
				on:click={newFinding}><Plus size={13} />Finding</button
			>
		{/if}
	</div>
	{#each links as link (link.record.ID)}
		{@const open = unfolded.has(link.record.ID)}
		{@const done = completenessOf(link.kind, link.record).status === "done"}
		<div class="mb-1.5 ring-1 ring-surface-500/25">
			<div class="flex h-9 items-center gap-2 px-2">
				<button
					class="flex h-full min-w-0 flex-1 items-center gap-2 text-left"
					aria-expanded={open}
					on:click={() => toggle(link.record.ID)}
				>
					{#if open}<ChevronDown size={12} class="flex-none" />{:else}<ChevronRight size={12} class="flex-none" />{/if}
					{#if link.kind === "finding"}<span
							class="badge rounded-sm px-1.5 py-0.5 text-[10px] font-bold {SEVERITY_BADGE[link.record.Severity] ??
								'variant-soft'}">{link.record.Severity || "None"}</span
						>{:else}<BookCheck size={13} class="flex-none text-tertiary-500" />{/if}
					<span class="min-w-0 flex-1 truncate text-xs font-semibold">{link.record.Title}</span>
				</button>
				<span class="flex-none text-[10px] {done ? 'text-success-700 dark:text-success-400' : 'text-warning-800 dark:text-warning-400'}"
					>{done ? "Done" : "In progress"}</span
				>
				<button
					class="flex flex-none items-center gap-1 px-1 text-xs opacity-70 hover:opacity-100"
					title="Open {link.record.Title}"
					on:click={() => onOpen(link.kind, link.record.ID)}><CornerDownRight size={13} />Open</button
				>
			</div>
			{#if open}
				<div class="grid gap-4 border-t border-surface-500/20 px-3 py-2.5 {wide ? 'grid-cols-2' : ''}">
					{#each fieldsOf(link) as [label, text]}
						<div>
							<div class={heading}>{label}</div>
							<p class="whitespace-pre-wrap text-xs leading-relaxed {text?.trim() ? '' : 'italic opacity-50'}">
								{text?.trim() || "Empty"}
							</p>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{:else}
		<p class="text-[11px] italic opacity-50">{kind === "finding" ? "Not linked to a test case" : "No findings"}</p>
	{/each}
</div>
