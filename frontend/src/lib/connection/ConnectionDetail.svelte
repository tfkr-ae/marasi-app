<script>
	// One connection's details in the Variant E action-first layout:
	// 1. Compact identity header: name, status dot + label, host/instance/OS,
	//    and Marasi <version> (<channel>) · API <level> when reached.
	// 2. Top action bar directly below the header (Switch / Stop / Start /
	//    Retry; ready for Restart and service update actions).
	// 3. Single contextual slot directly beneath the action bar (at most one
	//    card: inline Stop confirmation, password prompt, CLI setup, outdated
	//    instance recovery, stopped/failed/error notice, or API warning).
	// 4. Operational rows: Project and Access (ConnectionAccess).
	// 5. Collapsed setup disclosure shell (ready for channel, reinstall, and
	//    desktop local CLI / quit controls), followed by connection management
	//    rows (Address/Remove on remotes, Proxy port/Remove on added locals).
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import { ChevronDown, ChevronRight, Power, RotateCw } from "lucide-svelte";
	import { neutralButton, primaryButton } from "../launchpad/format.js";
	import { projectName } from "../openProgress.js";
	import { mobile } from "../platform.js";
	import { connectionStore } from "../../stores/connectionStore.js";
	import { phaseLabel, phaseTone, removeBlock } from "./status.js";
	import { detailWhereText, serviceMetaText, setupDisclosure, stopConfirmCopy } from "./detail.js";
	import { errorText, localInstanceControl, removeConnection, setAddress, setPort } from "./manage.js";
	import { PORT_RANGE_MESSAGE, parsePort, portText } from "./localPort.js";
	import { cliMissing, outdatedVersion } from "./cli.js";
	import CLISetup from "./CLISetup.svelte";
	import OutdatedInstance from "./OutdatedInstance.svelte";
	import UpdateCLI from "./UpdateCLI.svelte";
	import ConnectionAccess from "./ConnectionAccess.svelte";

	export let connection;
	/** Settings rows instead of the compact modal spacing. */
	export let rows = false;

	$: neutral = neutralButton($modeCurrent);
	$: primary = primaryButton($modeCurrent);
	let setupOpen = false;
	let password = "";
	let passwordError = "";
	let address = connection.url ?? "";
	let manageError = "";
	function enterPassword() {
		passwordError = connectionStore.enterPassword(password) ?? "";
		if (!passwordError) password = "";
	}
	async function saveAddress() {
		manageError = "";
		try {
			await setAddress(connection.id, address.trim());
		} catch (err) {
			manageError = errorText(err);
		}
	}
	let port = portText(connection.port);
	async function savePort() {
		manageError = "";
		const value = parsePort(port);
		if (value === null) {
			manageError = PORT_RANGE_MESSAGE;
			return;
		}
		try {
			await setPort(connection.id, value);
		} catch (err) {
			manageError = errorText(err);
		}
	}
	async function remove() {
		manageError = "";
		try {
			await removeConnection(connection.id);
		} catch (err) {
			manageError = errorText(err);
		}
	}

	$: added = connection.kind === "local" && connection.id !== "local";
	$: state = $connectionStore;
	$: isActive = connection.id === state.connection.id;
	$: phase = isActive ? state.phase : "idle";
	$: reached = isActive && state.version !== null && phase !== "stopped";
	$: isCLIMissing = isActive && phase === "failed" && connection.kind === "local" && cliMissing(state.error);
	$: isOutdated = isActive && phase === "failed" && connection.kind === "local" && outdatedVersion(state.error) !== null;

	// A local connection's instance: whether it runs and whether the app owns
	// the run, read again as the active connection or its phase changes (a
	// switch away, a stop), with Stop and Start while it isn't active.
	const local = connection.kind === "local" ? localInstanceControl(connection) : null;
	$: instance = local ? $local : null;
	$: if (local) local.refresh(isActive, state.phase);
	$: removeHint = removeBlock({ isActive, ownedRun: added && Boolean(instance?.owned) });

	$: whereLine = detailWhereText(connection, isActive ? { instance: state.instance, os: state.os } : {});
	$: serviceMeta = reached ? serviceMetaText(state) : null;
	$: statusTone = isActive && state.restarting ? "bg-warning-500" : phaseTone(phase);
	$: statusLabel = isActive && state.restarting ? "Restarting" : phaseLabel(phase);
	$: statusPulsing = phase === "reconnecting" || (isActive && state.restarting);

	$: activeStopAsk = isActive && phase === "connected" && state.stopAsk;
	$: inactiveStopAsk = !isActive && Boolean(local && instance?.stopAsk);
	$: showStopConfirm = activeStopAsk || inactiveStopAsk;
	$: stopCopy = stopConfirmCopy(connection);
	$: stopErrorText = isActive ? state.stopError : (instance?.error || null);

	function confirmStop() {
		if (activeStopAsk) connectionStore.confirmStop();
		else if (local) local.confirmStop();
	}
	function cancelStop() {
		if (activeStopAsk) connectionStore.cancelStop();
		else if (local) local.cancelStop();
	}

	$: showActionBar =
		!isActive ||
		phase === "connected" ||
		phase === "stopped" ||
		(phase === "failed" && !isCLIMissing && !isOutdated);

	$: setup = setupDisclosure(connection, {
		channel: state.channel,
		version: state.version,
		mobile: $mobile,
	});

	const row = rows
		? "settings-row flex items-center justify-between gap-8 py-3 border-b border-surface-300 dark:border-surface-600"
		: "settings-row flex items-center justify-between gap-4 py-2.5 border-b border-surface-300 dark:border-surface-600";
</script>

<div class="text-sm" data-testid="connection-detail">
	<!-- 1. Compact identity header -->
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0 flex-1">
			<h3 class="text-base font-bold leading-tight">{connection.name}</h3>
			<p class="mt-0.5 truncate font-mono text-2xs opacity-65" data-testid="connection-where">{whereLine}</p>
			{#if serviceMeta}
				<p class="mt-1 font-mono text-2xs opacity-80" data-testid="connection-service-meta">{serviceMeta}</p>
			{/if}
		</div>
		<span class="flex shrink-0 items-center gap-1.5 text-xs" data-testid="connection-status">
			<span class="h-2 w-2 rounded-full {statusTone}" class:animate-pulse={statusPulsing}></span>
			{statusLabel}
		</span>
	</div>

	<!-- 2. Top action bar -->
	{#if showActionBar}
		<div class="connection-actions mt-4 flex flex-wrap gap-2" data-testid="connection-actions">
			{#if !isActive}
				<button
					type="button"
					class="{primary} justify-center"
					data-testid="connection-switch"
					on:click={() => connectionStore.switchTo(connection.id)}
				>
					Switch
				</button>
				{#if local && instance && instance.running !== null}
					{#if instance.running}
						<button
							type="button"
							class="{neutral} justify-center"
							disabled={instance.busy !== null}
							data-testid="connection-stop"
							on:click={() => local.stop()}
						>
							<Power size={14} /><span>{instance.busy === "stop" ? "Stopping…" : "Stop"}</span>
						</button>
					{:else}
						<button
							type="button"
							class="{neutral} justify-center"
							disabled={instance.busy !== null}
							data-testid="connection-detail-start"
							on:click={() => local.start()}
						>
							<Power size={14} /><span>{instance.busy === "start" ? "Starting…" : "Start"}</span>
						</button>
					{/if}
				{/if}
			{:else if phase === "connected"}
				<button
					type="button"
					class="{neutral} justify-center"
					disabled={state.busy !== null || state.restarting}
					data-testid="connection-stop"
					on:click={() => connectionStore.stop()}
				>
					<Power size={14} /><span>{state.busy === "stop" ? "Stopping…" : "Stop"}</span>
				</button>
			{:else if phase === "stopped"}
				{#if connection.kind === "local"}
					<button
						type="button"
						class="{primary} justify-center"
						data-testid="connection-detail-start"
						on:click={() => connectionStore.startInstance()}
					>
						<Power size={14} /><span>Start</span>
					</button>
				{:else}
					<button
						type="button"
						class="{neutral} justify-center"
						data-testid="connection-detail-retry"
						on:click={() => connectionStore.retry()}
					>
						<RotateCw size={14} /><span>Retry</span>
					</button>
				{/if}
			{:else if phase === "failed"}
				<button
					type="button"
					class="{neutral} justify-center"
					data-testid="connection-detail-retry"
					on:click={() => connectionStore.retry()}
				>
					<RotateCw size={14} /><span>Retry</span>
				</button>
			{/if}
		</div>
	{/if}

	<!-- 3. Single contextual slot directly below the action bar -->
	{#if showStopConfirm}
		<div
			class="mt-3 flex flex-wrap items-center justify-between gap-2 border-l-4 border-error-500 bg-error-500/15 px-3 py-2.5 text-xs"
			data-testid="connection-context"
		>
			<div class="min-w-0">
				<p class="font-semibold" data-testid="connection-stop-title">{stopCopy.title}</p>
				<p class="opacity-80" data-testid="connection-stop-hint">{stopCopy.detail}</p>
			</div>
			<div class="connection-context-actions flex items-center gap-2">
				<button type="button" class={neutral} on:click={cancelStop}>Cancel</button>
				<button type="button" class={primary} data-testid="connection-stop-confirm" on:click={confirmStop}>Stop</button>
			</div>
		</div>
	{:else if isActive && phase === "auth-failed"}
		<div class="mt-3" data-testid="connection-context">
			<form class="flex items-center gap-3 border-l-4 border-error-500 bg-error-500/10 p-3" data-testid="connection-password-prompt" on:submit|preventDefault={enterPassword}>
				<p class="text-xs">{state.error}</p>
				<input class="input h-8 min-w-0 flex-1 py-1 text-xs" type="password" placeholder="Password" data-testid="connection-password" bind:value={password} />
				<button type="submit" class={primary} disabled={!password}>Connect</button>
			</form>
			{#if passwordError}<p class="mt-1 text-xs text-error-600 dark:text-error-400">{passwordError}</p>{/if}
		</div>
	{:else if isCLIMissing}
		<div class="mt-3" data-testid="connection-context">
			<CLISetup />
		</div>
	{:else if isOutdated}
		<div class="mt-3 border-l-4 border-warning-500 bg-warning-500/15 p-3" data-testid="connection-context">
			<OutdatedInstance error={state.error} />
		</div>
	{:else if isActive && phase === "stopped"}
		<div class="mt-3 border-l-4 border-surface-400 bg-surface-500/10 px-3 py-2 text-xs" data-testid="connection-stopped">
			Marasi stopped. {connection.kind === "local" ? "Start it again to resume working." : "Start it on the remote host, then retry."}
		</div>
	{:else if isActive && phase === "failed"}
		<div class="mt-3 border-l-4 border-error-500 bg-error-500/10 px-3 py-2 text-xs" role="alert" data-testid="connection-context">
			<p class="min-w-0 break-words">{state.error}</p>
		</div>
	{:else if stopErrorText}
		<div class="mt-3 border-l-4 border-error-500 bg-error-500/15 px-3 py-2 text-xs text-error-700 dark:text-error-300" role="alert" data-testid="connection-context">
			{stopErrorText}
		</div>
	{:else if isActive && state.apiWarning}
		<div class="mt-3 space-y-2 border-l-4 border-warning-500 bg-warning-500/15 px-3 py-2 text-xs" data-testid="connection-api-warning">
			<p>{state.apiWarning}. Some features may not work.</p>
			{#if connection.kind === "local" && phase === "connected"}<UpdateCLI />{/if}
		</div>
	{/if}

	<!-- 4. Operational rows: Project and Access -->
	{#if reached}
		<div class="mt-4 border-t border-surface-300 dark:border-surface-600">
			<div class={row}>
				<div>
					<p>Project</p>
					<p class="text-xs opacity-70">Currently open</p>
				</div>
				<div class="min-w-0 text-right">
					<p class="truncate font-semibold" data-testid="connection-project">{projectName(state.project)}</p>
					<p class="truncate font-mono text-2xs opacity-60" title={state.project}>{state.project}</p>
				</div>
			</div>
		</div>
	{/if}

	{#if reached || !isActive}
		<ConnectionAccess {connection} {row} flush={reached} />
	{/if}

	<!-- 5. Collapsed setup disclosure shell -->
	{#if reached}
		<div class="mt-4" data-testid="connection-setup">
			<button
				type="button"
				class="flex w-full items-center justify-between gap-2 bg-surface-200/70 px-3 py-2 text-left text-xs font-semibold hover:bg-surface-200 dark:bg-surface-700/60 dark:hover:bg-surface-700"
				aria-expanded={setupOpen}
				data-testid="connection-setup-toggle"
				on:click={() => (setupOpen = !setupOpen)}
			>
				<span class="flex min-w-0 items-center gap-1.5">
					{#if setupOpen}<ChevronDown size={14} class="shrink-0" />{:else}<ChevronRight size={14} class="shrink-0" />{/if}
					<span class="truncate">{setup.title}</span>
				</span>
				{#if setup.summary}
					<span class="shrink-0 font-mono text-2xs font-normal opacity-65" data-testid="connection-setup-summary">{setup.summary}</span>
				{/if}
			</button>
			{#if setupOpen}
				<div class="border border-t-0 border-surface-300 px-3 py-1 dark:border-surface-600" data-testid="connection-setup-body">
					<div class="settings-row flex items-center justify-between gap-4 py-2.5">
						<div>
							<p>Update channel</p>
							<p class="text-xs opacity-70">Builds {connection.name} checks</p>
						</div>
						<p class="font-mono text-xs opacity-75" data-testid="connection-setup-channel">
							{state.channel ?? (state.version === "dev" ? "dev" : "unavailable")}
						</p>
					</div>
				</div>
			{/if}
		</div>
	{/if}

	<!-- 6. Connection management rows -->
	{#if connection.kind === "remote"}
		<div class="mt-3 border-t border-surface-300 dark:border-surface-600">
			<div class={row}>
				<div>
					<p>Address</p>
					<p class="text-xs opacity-70">The service's control listener</p>
				</div>
				<form class="flex min-w-0 items-center gap-2" on:submit|preventDefault={saveAddress}>
					<input class="narrow-full input h-8 w-56 py-1 font-mono text-xs" data-testid="connection-address" bind:value={address} />
					<button type="submit" class={neutral} disabled={!address.trim() || address.trim() === connection.url}>Save</button>
				</form>
			</div>
			<div class={row}>
				<div>
					<p>Remove</p>
					<p class="text-xs opacity-70">{removeHint ?? "Forget it and its password"}</p>
				</div>
				<button type="button" class={neutral} disabled={removeHint !== null} data-testid="connection-remove" on:click={remove}>Remove</button>
			</div>
		</div>
	{/if}

	{#if added}
		<div class="mt-3 border-t border-surface-300 dark:border-surface-600" data-testid="connection-local-manage">
			<div class={row}>
				<div>
					<p>Proxy port</p>
					<p class="text-xs opacity-70">From the next Start; blank for any</p>
				</div>
				<form class="flex min-w-0 items-center gap-2" on:submit|preventDefault={savePort}>
					<input class="input h-8 w-24 py-1 font-mono text-xs" inputmode="numeric" placeholder="Any" data-testid="connection-port" bind:value={port} />
					<button type="submit" class={neutral} disabled={port.trim() === portText(connection.port)}>Save</button>
				</form>
			</div>
			<div class={row}>
				<div>
					<p>Remove</p>
					<p class="text-xs opacity-70" data-testid="connection-remove-hint">{removeHint ?? "Forget it; the instance keeps running"}</p>
				</div>
				<button type="button" class={neutral} disabled={removeHint !== null} data-testid="connection-remove" on:click={remove}>Remove</button>
			</div>
		</div>
	{/if}
	{#if manageError}<p class="mt-2 text-xs text-error-600 dark:text-error-400" data-testid="connection-manage-error">{manageError}</p>{/if}
</div>

<style>
	/* Narrow mobile layout (html.mobile, lib/platform.js): the top action bar
	   and contextual confirmation buttons share full width equally. */
	@media (max-width: 40rem) {
		:global(html.mobile .connection-actions),
		:global(html.mobile .connection-context-actions) {
			display: flex;
			width: 100%;
			gap: 0.5rem;
		}
		:global(html.mobile .connection-actions > .btn),
		:global(html.mobile .connection-context-actions > .btn) {
			flex: 1 1 0;
			justify-content: center;
		}
	}
</style>
