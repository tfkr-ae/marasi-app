<script>
	// The connected instance's version in the connection status, with its
	// update actions. The bundled Marasi updates with the app, so its
	// instances show no update actions; any instance offers a restart once
	// an install replaced its build.
	import { getModalStore, modeCurrent } from "@skeletonlabs/skeleton";
	import { instanceUpdate } from "../../stores/instanceUpdateStore.js";
	import { primaryVariant } from "../launchpad/format.js";

	const modalStore = getModalStore();

	$: state = $instanceUpdate;
	$: install = state.install;
	$: running = install.state === "running";
	$: percent = running && install.total ? Math.floor((100 * install.received) / install.total) : null;

	$: button = "btn btn-sm rounded-none px-2 py-0.5 " + primaryVariant($modeCurrent);

	async function restart() {
		const result = await instanceUpdate.restart();
		if (!result.held) return;
		modalStore.trigger({
			type: "confirm",
			title: "Checkpoint has intercepted items",
			body: `Restarting drops ${result.held.length === 1 ? "1 item" : `${result.held.length} items`}.`,
			buttonTextConfirm: "Restart anyway",
			buttonTextCancel: "Cancel",
			response: (ok) => {
				if (ok) instanceUpdate.restart({ force: true });
			},
		});
	}
</script>

{#if state.version}
	<span data-testid="instance-version">
		· Marasi <span class="font-mono">{state.version}</span>
		{#if state.restarting}
			· Restarting…
		{:else if state.restartRequired}
			· <span class="font-semibold text-warning-700 dark:text-warning-400">restart needed</span>
			<button class={button} on:click={restart}>Restart</button>
		{/if}
		{#if state.canUpdate && !state.restarting}
			{#if running}
				· Installing {install.version}{percent !== null ? ` ${percent}%` : "…"}
				<button class={button} on:click={() => instanceUpdate.cancel()}>Cancel</button>
			{:else if state.available && !state.restartRequired}
				· {state.available.version} available
				<button class={button} on:click={() => instanceUpdate.install()}>Install</button>
			{:else if !state.restartRequired}
				<button
					class={button}
					disabled={state.checking || state.development}
					title={state.development ? "A development build doesn't update" : null}
					on:click={() => instanceUpdate.check()}
				>
					{state.checking ? "Checking…" : "Check for updates"}
				</button>
			{/if}
		{/if}
		{#if state.error}
			<span class="text-error-600 dark:text-error-400" role="status">· {state.error}</span>
		{/if}
	</span>
{/if}
