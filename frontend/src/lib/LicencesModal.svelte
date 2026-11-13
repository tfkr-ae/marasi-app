<script>
	// The open-source licences, from Settings → About's View: the libraries
	// the app ships, from the licences.json the build writes
	// (frontend/notices.js). Each row opens to its licence text. Registered
	// as "Licences" (routes/+layout.svelte).
	import { getModalStore } from "@skeletonlabs/skeleton";
	import { X } from "lucide-svelte";
	import { onMount } from "svelte";

	const modalStore = getModalStore();
	let notices = null;
	let missing = false;

	onMount(async () => {
		try {
			const response = await fetch("/licences.json");
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			notices = await response.json();
		} catch {
			missing = true;
		}
	});

	$: groups = notices
		? [
				{ name: "Go", entries: notices.go ?? [] },
				{ name: "JavaScript", entries: notices.npm ?? [] },
			]
		: [];
</script>

{#if $modalStore[0]}
	<div
		class="licences-modal card w-[44rem] max-w-full rounded-none bg-surface-50-800-token text-sm shadow-xl text-surface-900-50-token"
		data-testid="licences-modal"
	>
		<header class="flex items-center justify-between border-b border-surface-300 px-4 py-3 dark:border-surface-600">
			<h2 class="text-base font-bold">Open-source licences</h2>
			<button type="button" aria-label="Close" on:click={modalStore.close}><X size={16} /></button>
		</header>
		<div class="licences-body max-h-[70vh] overflow-y-auto px-5 py-4">
			<p class="mb-3 text-xs opacity-70">Marasi includes these open-source libraries.</p>
			{#if missing}
				<p class="text-sm opacity-70" data-testid="licences-missing">Licences are listed in built apps only.</p>
			{:else if !notices}
				<p class="text-sm opacity-70">Loading…</p>
			{:else}
				{#each groups as group}
					<h3 class="mt-4 text-xs font-semibold uppercase tracking-wide opacity-60">{group.name}</h3>
					<ul data-testid="licences-{group.name.toLowerCase()}">
						{#each group.entries as entry (`${entry.name}@${entry.version}`)}
							<li class="border-b border-surface-300 dark:border-surface-600">
								<details>
									<summary class="flex min-h-10 cursor-pointer items-center gap-2 py-2 text-sm">
										<span class="min-w-0 flex-1 truncate" title={entry.name}>{entry.name}</span>
										<span class="min-w-0 max-w-[40%] truncate font-mono text-xs opacity-60" title={entry.version}>{entry.version}</span>
										{#if entry.licence}<span class="badge variant-soft text-3xs">{entry.licence}</span>{/if}
									</summary>
									{#if entry.text}
										<pre class="mb-3 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs opacity-80">{entry.text}</pre>
									{:else}
										<p class="mb-3 text-xs opacity-70">No licence file ships with this package.</p>
									{/if}
								</details>
							</li>
						{/each}
					</ul>
				{/each}
			{/if}
		</div>
	</div>
{/if}

<style>
	/* The mobile layout (html.mobile, lib/platform.js): the list fills the
	   sheet instead of a floating box's 70vh. */
	:global(html.mobile .licences-modal) {
		display: flex;
		flex-direction: column;
	}
	:global(html.mobile .licences-body) {
		flex: 1 1 0;
		max-height: none;
	}
</style>
