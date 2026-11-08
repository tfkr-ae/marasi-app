<script>
	// The strip over the page while the connection is unhealthy (reconnecting,
	// failed with its reason and Retry, a project change, Marasi stopped with
	// Start for a local connection and Retry for a remote) or the
	// service is at an API level the app doesn't support (it warns, never
	// blocks; the local connection offers Update CLI), and the
	// drop and reconnect toasts (lib/connectionToasts.js). Pages stay
	// mounted underneath.
	import { onDestroy, onMount } from "svelte";
	import { getToastStore, modeCurrent } from "@skeletonlabs/skeleton";
	import { neutralVariant } from "../launchpad/format.js";
	import { createConnectionToasts } from "../connectionToasts.js";
	import { projectName } from "../openProgress.js";
	import { connectionStore } from "../../stores/connectionStore.js";
	import UpdateCLI from "../connection/UpdateCLI.svelte";
	import { reachingText } from "../connection/status.js";
	import { service } from "../service/index.js";
	import { SERVICE_UPDATE_EVENTS, serviceUpdateToast } from "../../stores/serviceUpdateStore.js";

	$: neutral = `btn btn-sm rounded-none py-0.5 ${neutralVariant($modeCurrent)}`;
	$: name = $connectionStore.connection.name;

	const toastStore = getToastStore();
	onDestroy(connectionStore.subscribe(createConnectionToasts(toastStore)));
	// The connected service's own update: a short toast for found, installed
	// and failed (Settings → Updates shows the rest).
	onMount(() => {
		const stops = SERVICE_UPDATE_EVENTS.map((event) =>
			service.on(event, (data) => {
				const toast = serviceUpdateToast(event, data ?? {}, $connectionStore.connection.name);
				if (toast) toastStore.trigger({ ...toast, timeout: 5000 });
			}),
		);
		return () => stops.forEach((stop) => stop());
	});
</script>

{#if $connectionStore.phase === "reconnecting"}
	<div class="flex items-center gap-3 bg-warning-500/20 px-4 py-1.5 text-xs" data-testid="connection-banner">
		<span class="h-2 w-2 animate-pulse rounded-full bg-warning-500"></span>
		{#if $connectionStore.restarting}
			<span class="flex-1">Restarting {name}. Your work stays where it is.</span>
		{:else}
			<span class="flex-1">Reconnecting to {name} (attempt {$connectionStore.attempt}). Your work stays where it is.</span>
		{/if}
		<button type="button" class={neutral} disabled={$connectionStore.trying} on:click={() => connectionStore.retryNow()}>
			Retry now
		</button>
	</div>
{:else if $connectionStore.phase === "failed"}
	<!-- A connect or switch that failed after startup: the pages stay, so the
	     reason shows here as well as in the connection's details. -->
	<div class="flex items-center gap-3 bg-error-500/15 px-4 py-1.5 text-xs" data-testid="connection-banner">
		<span class="h-2 w-2 rounded-full bg-error-500"></span>
		<span class="min-w-0 flex-1 truncate" title={$connectionStore.error}>{name}: {$connectionStore.error}</span>
		<button type="button" class={neutral} on:click={() => connectionStore.retry()}>Retry</button>
	</div>
{:else if $connectionStore.phase === "stopped"}
	<div class="flex items-center gap-3 bg-surface-500/15 px-4 py-1.5 text-xs" data-testid="connection-banner">
		<span class="h-2 w-2 rounded-full bg-surface-400"></span>
		<span class="flex-1">Marasi stopped</span>
		{#if $connectionStore.connection.kind === "local"}
			<button type="button" class={neutral} data-testid="connection-start" on:click={() => connectionStore.startInstance()}>Start</button>
		{:else}
			<button type="button" class={neutral} on:click={() => connectionStore.retry()}>Retry</button>
		{/if}
	</div>
{:else if $connectionStore.switching && ($connectionStore.phase === "starting" || $connectionStore.phase === "connecting")}
	<div class="flex items-center gap-3 bg-warning-500/20 px-4 py-1.5 text-xs" data-testid="connection-banner">
		<span class="h-2 w-2 animate-pulse rounded-full bg-warning-500"></span>
		<span class="flex-1" data-testid="connection-banner-text">{reachingText($connectionStore)}</span>
	</div>
{:else if $connectionStore.phase === "connected" && $connectionStore.restarting}
	<div class="flex items-center gap-3 bg-warning-500/20 px-4 py-1.5 text-xs" data-testid="connection-banner">
		<span class="h-2 w-2 animate-pulse rounded-full bg-warning-500"></span>
		<span class="flex-1">Restarting {name}…</span>
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
