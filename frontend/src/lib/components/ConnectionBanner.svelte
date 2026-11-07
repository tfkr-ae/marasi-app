<script>
	// The strip over the page while the connection is unhealthy or the
	// service is at an API level the app doesn't support (it warns, never
	// blocks; the local connection offers Update CLI), and the
	// drop and reconnect toasts (lib/connectionToasts.js). Pages stay
	// mounted underneath.
	import { onDestroy } from "svelte";
	import { getToastStore, modeCurrent } from "@skeletonlabs/skeleton";
	import { neutralVariant } from "../launchpad/format.js";
	import { createConnectionToasts } from "../connectionToasts.js";
	import { projectName } from "../openProgress.js";
	import { connectionStore } from "../../stores/connectionStore.js";
	import UpdateCLI from "../connection/UpdateCLI.svelte";

	$: neutral = `btn btn-sm rounded-none py-0.5 ${neutralVariant($modeCurrent)}`;
	$: name = $connectionStore.connection.name;

	onDestroy(connectionStore.subscribe(createConnectionToasts(getToastStore())));
</script>

{#if $connectionStore.phase === "reconnecting"}
	<div class="flex items-center gap-3 bg-warning-500/20 px-4 py-1.5 text-xs" data-testid="connection-banner">
		<span class="h-2 w-2 animate-pulse rounded-full bg-warning-500"></span>
		<span class="flex-1">Reconnecting to {name} (attempt {$connectionStore.attempt}). Your work stays where it is.</span>
		<button type="button" class={neutral} disabled={$connectionStore.trying} on:click={() => connectionStore.retryNow()}>
			Retry now
		</button>
	</div>
{:else if $connectionStore.phase === "project-changed"}
	<div class="flex items-center gap-3 bg-warning-500/20 px-4 py-1.5 text-xs" data-testid="connection-banner">
		<span class="flex-1">{name} has {projectName($connectionStore.pendingProject)} open now. Load it to keep working.</span>
		<button type="button" class={neutral} on:click={() => connectionStore.loadPending()}>Load it</button>
	</div>
{:else if $connectionStore.phase === "connected" && $connectionStore.apiWarning}
	<div class="flex items-center gap-3 bg-warning-500/15 px-4 py-1.5 text-xs" data-testid="connection-banner">
		<span class="flex-1">{$connectionStore.apiWarning}. Some features may not work.</span>
		{#if $connectionStore.connection.kind === "local"}<UpdateCLI compact />{/if}
	</div>
{/if}
