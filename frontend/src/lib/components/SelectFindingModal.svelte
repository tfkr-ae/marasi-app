<script>
	import {
		Autocomplete,
		getModalStore,
		getToastStore,
	} from "@skeletonlabs/skeleton";
	import { X } from "lucide-svelte";
	import { findingStore } from "../../stores/findingStore";
	const modalStore = getModalStore();
	const toastStore = getToastStore();
	const placeholder = "Search for existing finding...";

	export let parent;
	let input = "";
	let requestID = $modalStore[0]?.meta?.requestID ?? "";
	let mode = $modalStore[0]?.meta?.mode ?? "link";

	$: autocompleteOptions = [...$findingStore]
		.reverse()
		.filter((finding) => {
			if (mode === "unlink") {
				return finding.Requests?.includes(requestID);
			}

			return !finding.Requests?.includes(requestID);
		})
		.map((finding, i) => ({
			label: `${i + 1} - ${finding.Title}`,
			value: finding.ID,
			...finding,
		}));
	const filter = () => {
		const inputFormatted = input.toLowerCase().trim();
		if (!inputFormatted) return autocompleteOptions;
		return autocompleteOptions.filter((opt) =>
			opt.label.toLowerCase().includes(inputFormatted),
		);
	};
</script>

{#if $modalStore[0]}
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<div
		class="card p-4 w-[65%] max-w-[95vw] shadow-xl rounded-0 flex flex-col max-h-[90vh]"
		on:keydown={(event) => {
			if (event.key === "Escape") {
				event.stopImmediatePropagation();
				modalStore.close();
			}
		}}
	>
		<header class="flex justify-between items-center p-2">
			<h2 class="text-xl font-bold">
				{mode === "link" ? "Link to" : "Unlink from"} finding
			</h2>
			<button
				class="text-2xl leading-none"
				aria-label="Close"
				on:click={modalStore.close}
			>
				<X />
			</button>
		</header>
		<input
			class="input"
			type="search"
			name="search"
			bind:value={input}
			{placeholder}
			autocomplete="off"
		/>

		{#if autocompleteOptions.length > 0}
			<div
				class="card p-2 w-full max-h-[200px] overflow-y-auto mt-1 shadow-xl border border-surface-500 z-10"
			>
				<Autocomplete
					bind:input
					options={autocompleteOptions}
					{filter}
					regionButton="w-full justify-start text-left truncate"
					on:selection={async (e) => {
						const selectedFinding =
							e.detail;
						const selectedID =
							selectedFinding.ID;
						input = "";

						try {
							if (mode === "link") {
								if (
									selectedFinding.Requests?.includes(
										requestID,
									)
								) {
									toastStore.trigger(
										{
											message: "Already linked",
											background: "variant-filled-warning",
										},
									);
								} else {
									await findingStore.linkRequest(
										selectedID,
										requestID,
									);
									toastStore.trigger(
										{
											message: "Linked successfully",
											background: "variant-filled-success",
										},
									);
								}
							} else {
								if (
									!selectedFinding.Requests?.includes(
										requestID,
									)
								) {
									toastStore.trigger(
										{
											message: "Not currently linked",
											background: "variant-filled-warning",
										},
									);
								} else {
									await findingStore.unlinkRequest(
										selectedID,
										requestID,
									);
									toastStore.trigger(
										{
											message: "Unlinked successfully",
											background: "variant-filled-success",
										},
									);
								}
							}
						} catch (err) {
							toastStore.trigger({
								message: `Error: ${err.message}`,
								background: "variant-filled-error",
							});
						}

						modalStore.close();
					}}
				/>
			</div>
		{:else}
			<div class="p-4 text-center opacity-50 italic">
				No findings found
			</div>
		{/if}
	</div>
{/if}
