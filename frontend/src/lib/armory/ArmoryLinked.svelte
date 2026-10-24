<script>
	// The drawer's Linked section: the findings and test cases that list the
	// open pair, each with an inline unlink. Nothing shows when there are none.
	import { BookCheck, ShieldAlert, X } from "lucide-svelte";

	/** The findings and test cases that list the pair. */
	export let findings = [];
	export let testCases = [];
	/** kind is "finding" or "test case". */
	export let onUnlink = (kind, target, title) => {};

	$: rows = [
		...findings.map((target) => ({ kind: "finding", target, title: target.Title || "Untitled finding" })),
		...testCases.map((target) => ({ kind: "test case", target, title: target.Title || "Untitled test case" })),
	];
</script>

{#if rows.length}
	<div class="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide opacity-50">Linked</div>
	{#each rows as { kind, target, title } (`${kind}-${target.ID}`)}
		<div class="armory-linked group flex flex-none items-center gap-2 py-0.5 pl-3 pr-2">
			{#if kind === "finding"}
				<ShieldAlert size={12} class="flex-none text-error-500" />
			{:else}
				<BookCheck size={12} class="flex-none text-tertiary-500" />
			{/if}
			<span class="min-w-0 flex-1 truncate" title={title}>{title}</span>
			<button
				class="flex h-5 w-5 flex-none items-center justify-center rounded-sm opacity-0 hover:bg-surface-200-700-token focus-visible:opacity-70 group-hover:opacity-70"
				title="Unlink"
				aria-label="Unlink from {kind} {title}"
				on:click={() => onUnlink(kind, target, title)}><X size={12} /></button
			>
		</div>
	{/each}
{/if}
