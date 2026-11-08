<script>
	// "Stop Marasi too?", asked when quitting while the app owns a run
	// (quitQuestion.js). meta: { question }, Go's QuitQuestion. The pressed
	// button and Don't ask again go back through the modal's response.
	import { getModalStore, modeCurrent } from "@skeletonlabs/skeleton";
	import { primaryVariant } from "../launchpad/format.js";
	import { namedConnections } from "./quitQuestion.js";

	export let parent;
	const modalStore = getModalStore();
	const names = namedConnections($modalStore[0]?.meta?.question);
	let remember = false;

	$: primary = primaryVariant($modeCurrent);

	function answer(choice) {
		$modalStore[0]?.response?.({ answer: choice, remember });
		modalStore.close();
	}
</script>

{#if $modalStore[0]}
	<div
		class="card w-full max-w-md space-y-3 rounded-0 bg-surface-50-800-token p-4 text-sm shadow-xl text-surface-900-50-token"
		data-testid="quit-question"
	>
		<h2 class="text-base font-bold">Stop Marasi too?</h2>
		{#if names.length}
			<ul class="list-disc pl-5" data-testid="quit-question-connections">
				{#each names as name}<li>{name}</li>{/each}
			</ul>
		{/if}
		<footer class="modal-footer {parent.regionFooter} items-center">
			<label class="mr-auto flex items-center gap-2 whitespace-nowrap text-xs">
				<input type="checkbox" class="checkbox" bind:checked={remember} />
				Don't ask again
			</label>
			<button type="button" class="btn btn-sm {parent.buttonNeutral}" on:click={() => answer("cancel")}>Cancel</button>
			<button type="button" class="btn btn-sm {parent.buttonNeutral}" on:click={() => answer("stop")}>Stop</button>
			<!-- svelte-ignore a11y-autofocus -->
			<button type="button" class="btn btn-sm {primary}" autofocus on:click={() => answer("keep")}>Keep running</button>
		</footer>
	</div>
{/if}
