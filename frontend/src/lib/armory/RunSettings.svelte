<script>
	// The run configuration: attack type, concurrency, HTTPS and wordlists,
	// with Create Draft and Launch. The page validates the configuration and
	// passes the result in; both actions wait on it.
	import { getModalStore, modeCurrent, SlideToggle } from "@skeletonlabs/skeleton";
	import { Plus, Rocket, X } from "lucide-svelte";
	import { neutralVariant, primaryVariant } from "../launchpad/format.js";

	export let attackType = "harpoon";
	export let useHTTPS = true;
	export let selectedWordlists = [];
	export let maxConcurrent = 10;
	export let launching = false;
	export let validating = false;
	export let validationError = "";
	export let onLaunch = () => {};
	export let onDraft = () => {};

	const modalStore = getModalStore();
	const attackTypes = ["harpoon", "broadside", "tandem", "maelstrom"];
	const attackDescriptions = {
		harpoon: "Applies one payload set to each template input in turn.",
		broadside: "Applies the same payload to every template input.",
		tandem: "Advances multiple payload sets together.",
		maelstrom: "Generates every combination of the selected payload sets.",
	};

	$: primary = primaryVariant($modeCurrent);
	$: neutral = neutralVariant($modeCurrent);
	$: blocked = launching || validating || !!validationError;

	function removeWordlist(index) {
		selectedWordlists = selectedWordlists.filter((_, i) => i !== index);
	}

	function openWordlistModal() {
		if ($modalStore[0]) return;
		modalStore.trigger({
			type: "component",
			component: "SelectWordlist",
			response: (name) => {
				if (name) selectedWordlists = [...selectedWordlists, name];
			},
		});
	}
</script>

<div class="space-y-3 p-3">
	<div class="grid grid-cols-2 gap-3">
		<label class="label min-w-0 text-sm">
			<span>Attack type</span>
			<select class="select h-8 py-1 text-sm" bind:value={attackType}>
				{#each attackTypes as type}
					<option value={type}>{type}</option>
				{/each}
			</select>
			<span class="block truncate text-xs opacity-60">{attackDescriptions[attackType]}</span>
		</label>
		<label class="label min-w-0 text-sm">
			<span>Concurrency</span>
			<input class="input h-8 py-1 text-sm" type="number" min="1" max="100" bind:value={maxConcurrent} />
		</label>
	</div>

	<div class="flex items-center gap-2">
		<span class="text-sm font-bold">HTTPS</span>
		<SlideToggle name="Armory HTTPS" size="sm" bind:checked={useHTTPS} />
	</div>
	<div>
		<div class="mb-2 flex items-center justify-between gap-2">
			<p class="text-sm font-bold">Wordlists</p>
			<button type="button" class="btn btn-sm {neutral}" on:click={openWordlistModal}>
				<Plus size={14} class="mr-1" /> Add Wordlist
			</button>
		</div>
		<div class="flex max-h-24 flex-wrap gap-2 overflow-y-auto">
			{#if selectedWordlists.length === 0}
				<span class="text-xs opacity-60">No wordlists selected</span>
			{:else}
				{#each selectedWordlists as wordlist, index}
					<span class="chip variant-soft-primary inline-flex items-center gap-1 px-2 py-0.5 text-xs">
						{wordlist}
						<button
							type="button"
							class="inline-flex"
							aria-label={`Remove ${wordlist}`}
							on:click={() => removeWordlist(index)}
						>
							<X size={12} />
						</button>
					</span>
				{/each}
			{/if}
		</div>
	</div>
	<div class="flex flex-wrap items-center justify-end gap-2">
		<button type="button" class="btn btn-sm {neutral}" disabled={blocked} on:click={onDraft}>Create Draft</button>
		<button type="button" class="btn btn-sm {primary}" disabled={blocked} on:click={onLaunch}>
			<Rocket size={14} class="mr-1" /> Launch
		</button>
	</div>
	<p
		class="min-h-4 text-xs {String(validationError).includes('requires exactly one wordlist')
			? 'text-primary-500'
			: 'text-error-500'}"
		class:invisible={!validationError}
		aria-live="polite"
	>
		{validationError || "Valid Armory configuration"}
	</p>
</div>
