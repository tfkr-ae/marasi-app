<script>
    import { getModalStore, modeCurrent } from "@skeletonlabs/skeleton";
    import { X } from "lucide-svelte";

    export let parent;
    let input = "";
	const modalStore = getModalStore();
	const cBase = 'card p-4 w-modal shadow-xl space-y-4 bg-surface-50-800-token text-surface-900-50-token';
	const cForm = 'space-y-4';
    function onInput() {
        $modalStore[0].response(input);
        modalStore.close();
    }
</script>

{#if $modalStore[0]}
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="modal-example-form {cBase} rounded-0" on:keydown={(event) => {
		if (event.key === 'Escape') {
            event.stopImmediatePropagation();
            modalStore.close();
        } 
    }}>
		<header class="flex justify-between items-center">
			<h2 class="text-xl font-bold">
				{$modalStore[0].title ?? '(title missing)'}
			</h2>
			<button class="text-2xl leading-none" aria-label="Close" on:click={modalStore.close}>
				<X />
			</button>
		</header>
		{#if $modalStore[0].body}
			<p>{$modalStore[0].body}</p>
		{/if}
		<form class="modal-form {cForm}" on:submit|preventDefault={onInput}>
			<label class="label">
				<input class="input bg-white dark:bg-surface-700 border-0 ring-0 focus:border-0 focus:ring-0" type="text" placeholder={$modalStore[0].meta?.placeholder ?? "Request No."} bind:value={input}/>
			</label>
		<!-- prettier-ignore -->
		<footer class="modal-footer {parent.regionFooter}">
			<button class="btn {$modeCurrent ? 'variant-ghost-primary border-0 ring-0' : 'variant-filled-primary'}">{$modalStore[0].buttonTextSubmit ?? "Continue"}</button>
        </footer>
        </form>
    </div>
{/if}
