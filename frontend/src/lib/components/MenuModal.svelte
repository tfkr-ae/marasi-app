<script>
    import { getModalStore } from "@skeletonlabs/skeleton";
    import { X } from "lucide-svelte";

    export let parent;
    let input = "";
	const modalStore = getModalStore();
	const cBase = 'card p-4 w-modal shadow-xl space-y-4';
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
			<button class="text-2xl leading-none focus:outline-none" tabindex="-1" on:click={modalStore.close}>
				<X />
			</button>
		</header>
        <form class="modal-form {cForm}">
            <label class="label">
                <input class="input" type="text" placeholder="Request No." bind:value={input}/>
            </label>
        <!-- prettier-ignore -->
        <footer class="modal-footer {parent.regionFooter}">
            <button class="btn {parent.buttonPositive}" on:click={onInput}>Continue</button>
        </footer>
        </form>
    </div>
{/if}