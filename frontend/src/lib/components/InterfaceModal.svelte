<script>
    import { getModalStore } from "@skeletonlabs/skeleton";
    import { GetInterfaces } from "../wailsjs/go/main/App";
    import { onMount } from "svelte";
    import { listener } from "../../stores";
    import { X } from "lucide-svelte";

    export let parent;
	let interfaceList = [];
	let selectedInterface = 0;
	let port = $listener.port;
	const modalStore = getModalStore();
	const cBase = 'card p-4 w-modal shadow-xl space-y-4';
	const cHeader = 'text-2xl font-bold';
	const cForm = 'space-y-4';
    function onInput() {
        const response = {
            "addr": interfaceList[selectedInterface],
            "port": port
        }
        if (response.addr && response.port) {
            $modalStore[0].response({"addr": interfaceList[selectedInterface], "port": port.toString()});
            modalStore.close();
        }
    }
	onMount(() => {
		GetInterfaces().then((interfaces) => {
			interfaces ? (interfaceList = interfaces) : (interfaceList = []);
			selectedInterface = interfaceList.indexOf($listener.address) ? interfaceList.indexOf($listener.address) : 0;
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
			<h2 class="text-xl font-bold">
				{$modalStore[0].title ?? '(title missing)'}
			</h2>
			<button class="text-2xl leading-none focus:outline-none" tabindex="-1" on:click={modalStore.close}>
				<X />
			</button>
		</header>
		<form class="modal-form {cForm}">
			<select bind:value={selectedInterface} class="select">
				{#each interfaceList as proxyInterface, index}
					<option value={index}
						>{proxyInterface}</option
					>
				{/each}
			</select>
			<input
				class="input variant-form-material"
				type="number"
				bind:value={port}
				placeholder="8080"
			/>
            <!-- prettier-ignore -->
            <footer class="modal-footer {parent.regionFooter}">
                <button class="btn {parent.buttonPositive}" on:click={onInput}>Continue</button>
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