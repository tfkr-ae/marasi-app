<script>
	// Update CLI, beside the API level warning on the local connection
	// (ConnectionBanner, ConnectionDetail): installs the CLI channel's release
	// with its progress, then restarts the local instance with it (updateCLI
	// in cli.js). An instance another program started asks first. The
	// restart drops the stream, and the reconnect sees a new run ID and loads
	// the project in full.
	import { getToastStore, modeCurrent } from "@skeletonlabs/skeleton";
	import { CheckForCLIUpdate, RestartLocalInstance } from "../bindings/github.com/tfkr-ae/marasi-app/app.js";
	import { neutralButton, primaryButton } from "../launchpad/format.js";
	import { connectionStore } from "../../stores/connectionStore.js";
	import { updateCLI } from "./cli.js";
	import CLIProgress from "./CLIProgress.svelte";

	/** Small buttons in one row, for the banner. */
	export let compact = false;

	const toastStore = getToastStore();
	let confirming = false;
	let busy = false;
	let problem = "";

	$: size = compact ? "py-0.5" : "";
	$: primary = `${primaryButton($modeCurrent)} ${size}`;
	$: neutral = `${neutralButton($modeCurrent)} ${size}`;

	function start() {
		if ($connectionStore.owned) run();
		else confirming = true;
	}

	async function run() {
		busy = true;
		problem = "";
		try {
			const outcome = await updateCLI({ checkForUpdate: CheckForCLIUpdate, restart: RestartLocalInstance });
			if (!outcome.ok) {
				problem = outcome.text;
				return;
			}
			confirming = false;
			toastStore.trigger({ message: outcome.text });
			connectionStore.retryNow();
		} catch (err) {
			problem = String(err?.message ?? err);
		} finally {
			busy = false;
		}
	}
</script>

<div class="flex flex-wrap items-center gap-2 text-xs" data-testid="update-cli">
	{#if confirming}
		<span class="opacity-70" data-testid="update-cli-confirm">Another program started it. Its project reopens in the new instance.</span>
		<button type="button" class={primary} disabled={busy} on:click={run} data-testid="update-cli-restart"
			>{busy ? "Updating…" : "Update and restart"}</button
		>
		<button type="button" class={neutral} disabled={busy} on:click={() => (confirming = false)}>Cancel</button>
	{:else}
		<button type="button" class={primary} disabled={busy} on:click={start} data-testid="update-cli-button"
			>{busy ? "Updating…" : "Update CLI"}</button
		>
	{/if}
	{#if busy}
		<div class="w-40"><CLIProgress /></div>
	{/if}
	{#if problem}
		<span class="bg-error-500/10 px-2 py-0.5 break-words" role="alert">{problem}</span>
	{/if}
</div>
