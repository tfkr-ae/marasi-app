<script>
	// Fills a test case's title, category and description from one of the
	// predefined test cases (the config's test case profile). Open at the
	// start of a new test case; a link on an existing one.
	import { createEventDispatcher } from "svelte";
	import { LayoutTemplate, Search } from "lucide-svelte";
	import { marasiConfig } from "../../stores";

	export let isNew = false;
	const dispatch = createEventDispatcher();
	let open = isNew;
	let q = "";

	$: templates = $marasiConfig?.TestCaseProfile?.TestCases ?? [];
	$: needle = q.trim().toLowerCase();
	$: hits = templates.filter((t) => `${t.Title} ${t.Category}`.toLowerCase().includes(needle));

	function pick(template) {
		dispatch("pick", { Title: template.Title, Category: template.Category, Description: template.Description });
		open = false;
		q = "";
	}
</script>

{#if templates.length}
	{#if open}
		<div class="rounded-container-token ring-1 ring-tertiary-500/40" data-template-picker>
			<div class="flex items-center gap-2 border-b border-surface-500/30 px-2 py-1">
				<Search size={12} class="opacity-60" />
				<input
					class="h-6 min-w-0 flex-1 border-0 bg-transparent p-0 text-xs focus:ring-0"
					placeholder={isNew ? "Start from a predefined test case" : "Overwrite from a predefined test case"}
					bind:value={q}
					on:keydown={(e) => e.key === "Enter" && hits[0] && (e.preventDefault(), pick(hits[0]))}
				/>
				<button type="button" class="text-2xs opacity-60 hover:opacity-100" on:click={() => (open = false)}>Hide</button>
			</div>
			<div class="max-h-32 overflow-auto py-0.5">
				{#each hits as template}
					<button type="button" class="flex w-full items-center gap-2 px-2 py-0.5 text-left text-2xs hover:bg-tertiary-500/15" on:click={() => pick(template)}>
						<span class="min-w-0 flex-1 truncate">{template.Title}</span>
						<span class="flex-none text-3xs opacity-60">{template.Category}</span>
					</button>
				{:else}
					<p class="px-2 py-1 text-2xs opacity-60">No match</p>
				{/each}
			</div>
		</div>
	{:else}
		<button type="button" class="flex items-center gap-1 self-start text-2xs opacity-70 hover:opacity-100" on:click={() => (open = true)}>
			<LayoutTemplate size={12} />{isNew ? "Use a template" : "Overwrite from a template"}
		</button>
	{/if}
{/if}
