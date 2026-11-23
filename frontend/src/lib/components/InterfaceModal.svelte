<script>
	import { getModalStore, modeCurrent } from "@skeletonlabs/skeleton";
	import { service } from "../service/index.js";
	import { listenerAddresses, listenerStart, startingInterface } from "../listenerInterfaces.js";
	import { neutralVariant, primaryVariant } from "../launchpad/format.js";
	import { onMount } from "svelte";
	import { marasiConfig } from "../../stores";
	import { homeStore } from "../../stores/homeStore.js";
	import { X } from "lucide-svelte";

	export let parent;
	let interfaceList = [];
	let selectedInterface = 0;
	// Active uses the running listener; off remembers the last active one,
	// else falls back to the app's default listener.
	const start = listenerStart($homeStore.listener, $marasiConfig, $homeStore.lastListener);
	let port = start.port;
	const modalStore = getModalStore();
	const cBase = 'card p-4 w-modal shadow-xl space-y-3 text-sm bg-surface-50-800-token text-surface-900-50-token';
	const cForm = 'space-y-3';
	function onInput() {
		const addr = interfaceList[selectedInterface];
		if (addr && port !== "" && port !== null && port !== undefined) {
			$modalStore[0].response({ addr, port: port.toString() });
			modalStore.close();
		}
	}
	function onStop() {
		$modalStore[0].response({ action: "stop" });
		modalStore.close();
	}
	onMount(() => {
		// The service host's interfaces, so a remote offers its own.
		listenerAddresses(service)
			.then((interfaces) => {
				interfaceList = interfaces;
				selectedInterface = startingInterface(interfaceList, start.address);
			})
			.catch((error) => console.error("Reading the service's interfaces failed:", error));
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
			<div class="flex items-center gap-2">
				<h2 class="text-base font-bold">
					{$modalStore[0].title ?? '(title missing)'}
				</h2>
				<span class="flex items-center gap-1.5 text-xs opacity-75" data-testid="listener-modal-status">
					<span
						class={"h-2 w-2 rounded-full " +
							($homeStore.listener.status ? "bg-success-500" : "bg-primary-500")}
					></span>
					{$homeStore.listener.status
						? `${$homeStore.listener.address}:${$homeStore.listener.port}`
						: "Off"}
				</span>
			</div>
			<button type="button" class="text-2xl leading-none" aria-label="Close" on:click={modalStore.close}>
				<X size={16} />
			</button>
		</header>
		<form class="modal-form {cForm}" on:submit|preventDefault={onInput}>
			<select bind:value={selectedInterface} class="select h-8 py-1 text-sm bg-white dark:bg-surface-700 border-0 ring-0 focus:border-0 focus:ring-0">
				{#each interfaceList as proxyInterface, index}
					<option value={index}
						>{proxyInterface}</option
					>
				{/each}
			</select>
			<input
				class="input h-8 py-1 text-sm bg-white dark:bg-surface-700 border-0 ring-0 focus:border-0 focus:ring-0"
				type="number"
				bind:value={port}
				placeholder="8080"
			/>
			<footer class="modal-footer flex items-center {$homeStore.listener.status ? 'justify-between' : 'justify-end'} gap-2">
				{#if $homeStore.listener.status}
					<button
						type="button"
						class="btn btn-sm {neutralVariant($modeCurrent)}"
						data-testid="listener-modal-stop"
						disabled={$homeStore.listenerBusy}
						on:click={onStop}
					>
						Stop Listener
					</button>
				{/if}
				<button
					type="submit"
					class="btn btn-sm {primaryVariant($modeCurrent)}"
					data-testid="listener-modal-submit"
					disabled={$homeStore.listenerBusy}
				>
					{$homeStore.listener.status ? "Update" : "Start Listener"}
				</button>
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
