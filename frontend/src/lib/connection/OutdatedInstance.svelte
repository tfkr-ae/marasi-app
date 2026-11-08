<script>
	// The local instance runs an older Marasi than the app needs
	// (instance_outdated), started by another program. Restart stops it and
	// starts its project again with the app's CLI (Go's
	// RestartLocalInstance), after a confirm, then connects. Shown in
	// ConnectionDetail and on the startup failure screen (+layout.svelte).
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import { RestartLocalInstance } from "../bindings/github.com/tfkr-ae/marasi-app/app.js";
	import { neutralButton, primaryButton } from "../launchpad/format.js";
	import { connectionStore } from "../../stores/connectionStore.js";
	import { outdatedVersion } from "./cli.js";

	export let error;
	/** Centre the text and buttons, as the startup screen does. */
	export let centred = false;

	let confirming = false;
	let busy = false;
	let problem = "";

	$: primary = primaryButton($modeCurrent);
	$: neutral = neutralButton($modeCurrent);
	$: version = outdatedVersion(error);

	async function restart() {
		busy = true;
		problem = "";
		try {
			await RestartLocalInstance($connectionStore.connection.id);
			confirming = false;
			connectionStore.retry();
		} catch (err) {
			problem = String(err?.message ?? err);
		} finally {
			busy = false;
		}
	}
</script>

<div class="space-y-2 text-xs" class:text-center={centred} data-testid="instance-outdated">
	<p>
		{version ? `Marasi ${version}` : "The running Marasi"} is older than this app needs.
	</p>
	{#if confirming}
		<p class="opacity-70" data-testid="instance-outdated-confirm">
			Another program started it. Its project reopens in the new instance.
		</p>
	{/if}
	<div class="flex gap-2" class:justify-center={centred}>
		{#if confirming}
			<button type="button" class={primary} disabled={busy} on:click={restart} data-testid="instance-restart-confirm"
				>{busy ? "Restarting…" : "Restart"}</button
			>
			<button type="button" class={neutral} disabled={busy} on:click={() => (confirming = false)}>Cancel</button>
		{:else}
			<button type="button" class={primary} on:click={() => (confirming = true)} data-testid="instance-restart"
				>Restart with the installed CLI</button
			>
			<button type="button" class={neutral} on:click={() => connectionStore.retry()}>Retry</button>
		{/if}
	</div>
	{#if problem}
		<p class="bg-error-500/10 px-2 py-1 break-words" role="alert">{problem}</p>
	{/if}
</div>
