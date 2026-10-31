<script>
    import { getModalStore, modeCurrent } from "@skeletonlabs/skeleton";
    import { GetInterfaces } from "../bindings/App";
    import { onMount } from "svelte";
    import { listener } from "../../stores";
    import { X } from "lucide-svelte";
    import { neutralVariant } from "../launchpad/format.js";

    export let parent;
	// The instance machine's addresses, {address, family, interface}, which
	// on a remote connection are not this machine's.
	let interfaceList = [];
	let selectedInterface = 0;
	let port = $listener.port;
	const modalStore = getModalStore();
	const cBase = 'card p-4 w-modal shadow-xl space-y-3 text-sm bg-surface-50-800-token text-surface-900-50-token';
	const cHeader = 'text-2xl font-bold';
	const cForm = 'space-y-3';
    function onInput() {
        const addr = interfaceList[selectedInterface]?.address;
        if (addr && port) {
            $modalStore[0].response({ addr, port: port.toString() });
            modalStore.close();
        }
    }
    function onStop() {
        $modalStore[0].response({ stop: true });
        modalStore.close();
    }
	onMount(() => {
		GetInterfaces().then((interfaces) => {
			interfaceList = interfaces ?? [];
			selectedInterface = Math.max(0, interfaceList.findIndex((item) => item.address === $listener.address));
		});
	});
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
			<h2 class="text-base font-bold">
				{$modalStore[0].title ?? '(title missing)'}
			</h2>
			<button class="text-2xl leading-none" aria-label="Close" on:click={modalStore.close}>
				<X size={16} />
			</button>
		</header>
		<form class="modal-form {cForm}">
			<select bind:value={selectedInterface} class="select h-8 py-1 text-sm bg-white dark:bg-surface-700 border-0 ring-0 focus:border-0 focus:ring-0">
				{#each interfaceList as proxyInterface, index}
					<option value={index}
						>{proxyInterface.address} ({proxyInterface.interface})</option
					>
				{/each}
			</select>
			<input
				class="input h-8 py-1 text-sm bg-white dark:bg-surface-700 border-0 ring-0 focus:border-0 focus:ring-0"
				type="number"
				bind:value={port}
				placeholder="8080"
			/>
            <!-- prettier-ignore -->
            <footer class="modal-footer {parent.regionFooter}">
                {#if $listener.status}
                    <button type="button" class="btn btn-sm {neutralVariant($modeCurrent)}" on:click={onStop}>Stop</button>
                {/if}
                <button class="btn btn-sm {$modeCurrent ? 'variant-ghost-primary border-0 ring-0' : 'variant-filled-primary'}" on:click={onInput}>Continue</button>
            </footer>
        </form>
    </div>
{/if}

<style>
	/* Chrome, Safari, Edge, Opera */
input::-webkit-outer-spin-button,
input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

/* Firefox */
input[type=number] {
  -moz-appearance: textfield;
}
</style>
