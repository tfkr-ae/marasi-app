<script>
	// A finding's test case: a chip with X, or a search over the test cases.
	import { createEventDispatcher } from "svelte";
	import { BookCheck, Search, X } from "lucide-svelte";
	import { categoryOf } from "../../stores/logbookStore.js";

	/** The linked test case's ID, or null. */
	export let value = null;
	export let testCases = [];
	const dispatch = createEventDispatcher();
	let q = "";
	let focused = false;

	$: linked = value ? testCases.find((t) => String(t.ID) === String(value)) : null;
	$: needle = q.trim().toLowerCase();
	$: hits = testCases
		.filter((t) => `${t.Title} ${t.Category}`.toLowerCase().includes(needle))
		.sort((a, b) => (a.Title ?? "").localeCompare(b.Title ?? ""))
		.slice(0, 8);

	function pick(testCase) {
		dispatch("change", testCase.ID);
		q = "";
		focused = false;
	}
</script>

{#if value}
	<div class="flex h-8 items-center gap-2 rounded-token bg-tertiary-500/15 px-2 text-xs" data-field="TestCaseID">
		<BookCheck size={13} class="flex-none text-tertiary-600 dark:text-tertiary-400" />
		<span class="min-w-0 flex-1 truncate font-semibold">{linked?.Title ?? "Test case"}</span>
		{#if linked}<span class="flex-none text-[10px] opacity-60">{categoryOf(linked)}</span>{/if}
		<button type="button" class="p-0.5 opacity-60 hover:opacity-100" title="Unlink the test case" aria-label="Unlink the test case" on:click={() => dispatch("change", null)}><X size={12} /></button>
	</div>
{:else}
	<div class="relative" data-field="TestCaseID">
		<div class="flex h-8 items-center gap-2 rounded-token bg-surface-200-700-token px-2 focus-within:ring-1 focus-within:ring-primary-500/60">
			<Search size={12} class="flex-none opacity-60" />
			<input
				class="h-6 min-w-0 flex-1 border-0 bg-transparent p-0 text-xs placeholder:opacity-60 focus:ring-0"
				placeholder={testCases.length ? "Link a test case" : "No test cases yet"}
				disabled={!testCases.length}
				bind:value={q}
				on:focus={() => (focused = true)}
				on:blur={() => (focused = false)}
				on:keydown={(e) => e.key === "Enter" && hits[0] && (e.preventDefault(), pick(hits[0]))}
			/>
		</div>
		{#if focused && hits.length}
			<div class="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-auto rounded-container-token bg-surface-50 py-1 shadow-xl ring-1 ring-surface-500/30 dark:bg-surface-800">
				{#each hits as testCase (testCase.ID)}
					<button type="button" class="flex w-full items-center gap-2 px-2 py-1 text-left text-xs hover:bg-primary-500/15" on:mousedown|preventDefault={() => pick(testCase)}>
						<span class="min-w-0 flex-1 truncate">{testCase.Title}</span>
						<span class="flex-none text-[10px] opacity-60">{categoryOf(testCase)}</span>
					</button>
				{/each}
			</div>
		{/if}
	</div>
{/if}
