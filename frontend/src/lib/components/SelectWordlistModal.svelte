<script>
	import { getModalStore } from "@skeletonlabs/skeleton";
	import { Eye, RefreshCw, X } from "lucide-svelte";
	import { armoryStore } from "../../stores/armoryStore";

	const modalStore = getModalStore();
	let input = "";
	let previewedWordlist = null;
	let previewEntries = [];
	let previewLoading = false;
	let refreshing = false;

	$: selected = $modalStore[0]?.meta?.selected || [];
	$: query = input.trim().toLowerCase();
	$: options = ($armoryStore.wordlists || []).filter((wordlist) => {
		if (selected.includes(wordlist.Name)) return false;
		return !query || wordlist.Name.toLowerCase().includes(query);
	});

	async function previewWordlist(name) {
		if (previewedWordlist === name) {
			previewedWordlist = null;
			previewEntries = [];
			return;
		}
		previewedWordlist = name;
		previewEntries = [];
		previewLoading = true;
		try {
			previewEntries = await armoryStore.previewWordlist(name, 20);
		} catch {
			previewedWordlist = null;
		} finally {
			previewLoading = false;
		}
	}

	function selectWordlist(name) {
		$modalStore[0]?.response?.(name);
		modalStore.close();
	}

	async function refreshWordlists() {
		refreshing = true;
		try {
			await armoryStore.loadWordlists();
		} finally {
			refreshing = false;
		}
	}
</script>

{#if $modalStore[0]}
	<div class="card flex max-h-[90vh] w-[65%] max-w-[95vw] flex-col rounded-0 p-4 shadow-xl bg-surface-50-800-token text-surface-900-50-token">
		<header class="flex items-center justify-between p-2">
			<h2 class="text-xl font-bold">Add Wordlist</h2>
			<div class="flex items-center gap-2">
				<button
					type="button"
					class="btn btn-sm-icon variant-ghost ring-0 shadow-none"
					aria-label="Refresh wordlists"
					disabled={refreshing}
					on:click={refreshWordlists}
				>
					<RefreshCw size={16} />
				</button>
				<button class="text-2xl leading-none" aria-label="Close" on:click={modalStore.close}>
					<X />
				</button>
			</div>
		</header>
		<input
			class="input bg-white dark:bg-surface-700 border-0 ring-0 focus:border-0 focus:ring-0"
			type="search"
			placeholder="Search wordlists..."
			bind:value={input}
			autocomplete="off"
		/>
		<div class="mt-2 min-h-0 flex-1 overflow-y-auto">
			{#if options.length === 0}
				<p class="p-2 text-sm opacity-60">No wordlists available</p>
			{:else}
				{#each options as wordlist (wordlist.Name)}
					<div>
						<div class="flex items-center gap-2 rounded px-2 py-1 hover:bg-surface-200 dark:hover:bg-surface-700">
							<button
								type="button"
								class="min-w-0 flex-1 truncate text-left text-sm"
								on:click={() => selectWordlist(wordlist.Name)}
							>
								{wordlist.Name}
							</button>
							<button
								type="button"
								class="btn btn-sm-icon variant-ghost ring-0 shadow-none"
								aria-label={`Preview ${wordlist.Name}`}
								on:click={() => previewWordlist(wordlist.Name)}
							>
								<Eye size={14} />
							</button>
						</div>
						{#if previewedWordlist === wordlist.Name}
							<div class="mb-2 ml-2 max-h-40 overflow-y-auto border-l border-surface-500/30 bg-white p-2 dark:bg-surface-700">
								{#if previewLoading}
									<p class="text-xs opacity-60">Loading preview...</p>
								{:else if previewEntries.length === 0}
									<p class="text-xs opacity-60">This wordlist is empty.</p>
								{:else}
									<ol class="list-decimal space-y-1 pl-6 font-mono text-xs">
										{#each previewEntries as entry}
											<li class="truncate">{entry}</li>
										{/each}
									</ol>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			{/if}
		</div>
	</div>
{/if}
