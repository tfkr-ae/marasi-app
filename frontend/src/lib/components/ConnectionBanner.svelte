<script>
	// The strip over the page while the connection is unhealthy (reconnecting,
	// failed with its reason and Retry, a project change, Marasi stopped with
	// Start for a local connection and Retry for a remote), the service is at an
	// unsupported API level, or an installed service update awaits a restart
	// (dismissible for this session/install), plus the drop/reconnect/update
	// toasts (lib/connectionToasts.js). Pages stay mounted underneath.
	import { onDestroy, onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { getModalStore, getToastStore, modeCurrent } from "@skeletonlabs/skeleton";
	import { neutralVariant, primaryVariant } from "../launchpad/format.js";
	import { createRestartHeldHandler } from "../checkpointHeld.js";
	import { createConnectionToasts } from "../connectionToasts.js";
	import { projectName } from "../openProgress.js";
	import { mobile } from "../platform.js";
	import { connectionStore } from "../../stores/connectionStore.js";
	import { localCLIStore } from "../../stores/localCLIStore.js";
	import UpdateCLI from "../connection/UpdateCLI.svelte";
	import { proactiveCarriedUpgrade } from "../connection/carried.js";
	import { connectionActionBanner } from "../connection/indicators.js";
	import { reachingText } from "../connection/status.js";
	import { service } from "../service/index.js";
	import { SERVICE_UPDATE_EVENTS, serviceUpdateStore, serviceUpdateToast } from "../../stores/serviceUpdateStore.js";

	$: neutral = `btn btn-sm rounded-none py-0.5 ${neutralVariant($modeCurrent)}`;
	$: primary = `btn btn-sm rounded-none py-0.5 ${primaryVariant($modeCurrent)}`;
	$: name = $connectionStore.connection.name;
	let dismissedRestartKey = null;
	$: carriedUpgrade = proactiveCarriedUpgrade({
		mobile: $mobile,
		connectionState: $connectionStore,
		updateState: $serviceUpdateStore,
		carried: $localCLIStore.carried,
		cli: $localCLIStore.cli,
		dismissedVersion: $localCLIStore.dismissedVersion,
	});
	$: actionBanner = connectionActionBanner($connectionStore, $serviceUpdateStore, {
		dismissedRestartKey,
		carriedUpgrade,
	});

	async function installCarriedFromBanner() {
		try {
			const outcome = await localCLIStore.installCarried({
				connectionState: $connectionStore,
				connectionId: $connectionStore.connection.id,
				isActive: true,
				restartService: () => connectionStore.restart(),
				retryConnection: () =>
					$connectionStore.phase === "failed" ? connectionStore.retry() : connectionStore.retryNow(),
			});
			if (outcome?.text) {
				toastStore.trigger({
					message: outcome.text,
					...(outcome.ok ? {} : { background: "variant-filled-error" }),
				});
			}
		} catch (err) {
			toastStore.trigger({ message: String(err?.message ?? err), background: "variant-filled-error" });
		}
	}

	const toastStore = getToastStore();
	const modalStore = getModalStore();
	onDestroy(connectionStore.subscribe(createConnectionToasts(toastStore)));
	onDestroy(
		connectionStore.subscribe(
			createRestartHeldHandler(modalStore, () => {
				modalStore.clear();
				goto("/checkpoint");
			}),
		),
	);
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
{:else if actionBanner?.kind === "restart-confirm"}
	<div
		class="flex flex-wrap items-center gap-2 bg-warning-500/15 px-4 py-1.5 text-xs"
		data-testid="connection-banner"
		data-banner-kind="restart-confirm"
	>
		<span class="h-2 w-2 rounded-full bg-warning-500"></span>
		<span class="min-w-0 flex-1">
			<span class="font-semibold">{actionBanner.title}</span>
			<span class="opacity-85"> {actionBanner.detail}</span>
		</span>
		<button type="button" class={neutral} data-testid="connection-banner-restart-cancel" on:click={() => connectionStore.cancelRestart()}>
			Cancel
		</button>
		<button type="button" class={primary} data-testid="connection-banner-restart-confirm" on:click={() => connectionStore.confirmRestart()}>
			Restart
		</button>
	</div>
{:else if actionBanner?.kind === "restart-required"}
	<div
		class="flex flex-wrap items-center gap-2 bg-warning-500/15 px-4 py-1.5 text-xs"
		data-testid="connection-banner"
		data-banner-kind="restart-required"
	>
		<span class="h-2 w-2 rounded-full bg-warning-500"></span>
		<span class="min-w-0 flex-1" data-testid="connection-banner-text">
			{#if actionBanner.version}
				{actionBanner.name} updated to <span class="font-mono">{actionBanner.version}</span>.
			{:else}
				{actionBanner.text}
			{/if}
		</span>
		<button
			type="button"
			class={primary}
			disabled={$connectionStore.busy !== null || $connectionStore.restartConfirming}
			data-testid="connection-banner-restart"
			on:click={() => connectionStore.restart()}
		>
			Restart
		</button>
		<button
			type="button"
			class={neutral}
			data-testid="connection-banner-dismiss"
			on:click={() => (dismissedRestartKey = actionBanner.key)}
		>
			Dismiss
		</button>
	</div>
{:else if actionBanner?.kind === "carried-upgrade"}
	<div
		class="flex flex-wrap items-center gap-2 bg-primary-500/15 px-4 py-1.5 text-xs"
		data-testid="connection-banner"
		data-banner-kind="carried-upgrade"
	>
		<span class="h-2 w-2 rounded-full bg-primary-500"></span>
		<span class="min-w-0 flex-1" data-testid="connection-banner-text">
			{#if actionBanner.version}
				Marasi CLI <span class="font-mono">{actionBanner.version}</span> included.
			{:else}
				{actionBanner.text}
			{/if}
		</span>
		<button
			type="button"
			class={primary}
			disabled={$localCLIStore.installing || $connectionStore.busy !== null || $connectionStore.restarting || $connectionStore.restartConfirming}
			data-testid="connection-banner-carried-install"
			on:click={installCarriedFromBanner}
		>
			{$localCLIStore.installing ? "Installing…" : "Install & restart"}
		</button>
		<button
			type="button"
			class={neutral}
			disabled={$localCLIStore.installing}
			data-testid="connection-banner-dismiss"
			on:click={() => localCLIStore.dismissCarried(actionBanner.version)}
		>
			Dismiss
		</button>
	</div>
{/if}
