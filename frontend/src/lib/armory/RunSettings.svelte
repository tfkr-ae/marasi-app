<script>
	// The run configuration: attack type, concurrency, HTTPS and wordlists,
	// with Launch and Save as draft in a pinned footer. The page validates the
	// configuration and passes the result in; both actions wait on it.
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

<!-- Fills its parent (a flex column): the fields scroll, the footer stays put. -->
<div class="flex min-h-0 flex-1 flex-col">
	<div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
		<div class="space-y-1.5">
			<div class="grid grid-cols-2 gap-3">
				<label class="label min-w-0 space-y-1 text-xs">
					<span class="font-bold">Attack type</span>
					<select class="select h-8 py-1 text-sm" bind:value={attackType}>
						{#each attackTypes as type}
							<option value={type}>{type}</option>
						{/each}
					</select>
				</label>
				<label class="label min-w-0 space-y-1 text-xs">
					<span class="font-bold">Concurrency</span>
					<input class="input h-8 py-1 text-sm" type="number" min="1" max="100" bind:value={maxConcurrent} />
				</label>
			</div>
			<p class="text-xs leading-snug opacity-60">{attackDescriptions[attackType]}</p>
		</div>

		<label class="flex items-center justify-between gap-2 text-xs">
			<span class="font-bold">Use HTTPS</span>
			<SlideToggle name="Armory HTTPS" size="sm" bind:checked={useHTTPS} />
		</label>

		<div class="space-y-1.5">
			<p class="text-xs font-bold">
				Wordlists <span class="font-normal opacity-60">{selectedWordlists.length}</span>
			</p>
			<button
				type="button"
				class="input flex h-8 w-full items-center gap-2 py-1 text-left text-sm"
				on:click={openWordlistModal}
			>
				<Plus size={14} class="flex-none opacity-60" />
				<span class="opacity-60">Add wordlist</span>
			</button>
			{#if selectedWordlists.length > 0}
				<div class="flex flex-wrap gap-1.5 pt-0.5">
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
				</div>
			{/if}
		</div>
	</div>

	<div class="flex-none space-y-2 border-t border-surface-500/30 bg-surface-50 p-3 dark:bg-surface-900">
		<p
			class="min-h-4 text-xs {String(validationError).includes('requires exactly one wordlist')
				? 'text-primary-500'
				: 'text-error-500'}"
			class:hidden={!validationError}
			aria-live="polite"
		>
			{validationError}
		</p>
		<button type="button" class="btn btn-sm w-full {primary}" disabled={blocked} on:click={onLaunch}>
			<Rocket size={14} class="mr-1.5" /> Launch
		</button>
		<button type="button" class="btn btn-sm w-full {neutral}" disabled={blocked} on:click={onDraft}>
			Save as draft
		</button>
	</div>
</div>
