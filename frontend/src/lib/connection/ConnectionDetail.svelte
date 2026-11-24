<script>
	// One connection's details in the Variant E action-first layout:
	// 1. Compact identity header: name, status dot + label, host/instance/OS,
	//    and Marasi <version> (<channel>) · API <level> when reached.
	// 2. Top action bar directly below the header (Check update / Update to
	//    <version> / Install <carriedVersion> / Restart to apply, Restart,
	//    Stop / Switch / Start / Retry).
	// 3. Single contextual slot directly beneath the action bar
	//    (ConnectionContextSlot.svelte).
	// 4. Operational rows: Project and Access (ConnectionAccess.svelte).
	// 5. Collapsed setup disclosure (ConnectionSetupDisclosure.svelte),
	//    followed by connection management rows (Address/Remove on remotes,
	//    Proxy port/Remove on added locals).
	import { onMount } from "svelte";
	import { getToastStore, modeCurrent } from "@skeletonlabs/skeleton";
	import { Download, Power, RefreshCw, RotateCw } from "lucide-svelte";
	import { neutralButton, primaryButton, primaryVariant } from "../launchpad/format.js";
	import { projectName } from "../openProgress.js";
	import { mobile } from "../platform.js";
	import { toastError } from "../toasts.js";
	import { marasiConfig } from "../../stores";
	import { connectionStore } from "../../stores/connectionStore.js";
	import { localCLIStore } from "../../stores/localCLIStore.js";
	import { serviceUpdateStore } from "../../stores/serviceUpdateStore.js";
	import { localChannelMismatch, proactiveCarriedUpgrade } from "./carried.js";
	import { phaseLabel, phaseTone, removeBlock } from "./status.js";
	import {
		contextualSlotKind,
		detailWhereText,
		formatServiceNotes,
		LOCAL_QUIT_CHOICES,
		resolvedServiceChannel,
		restartConfirmCopy,
		serviceChannelControls,
		serviceMetaText,
		serviceUpdateAction,
		serviceUpdateCheckToast,
		serviceUpdateProgress,
		setupDisclosure,
		stopConfirmCopy,
	} from "./detail.js";
	import {
		errorText,
		installCarriedWithToast,
		localInstanceControl,
		removeConnection,
		setAddress,
		setPort,
	} from "./manage.js";
	import { PORT_RANGE_MESSAGE, parsePort, portText } from "./localPort.js";
	import { cliMissing, offersCarriedCLI, outdatedVersion } from "./cli.js";
	import ConnectionAccess from "./ConnectionAccess.svelte";
	import ConnectionContextSlot from "./ConnectionContextSlot.svelte";
	import ConnectionSetupDisclosure from "./ConnectionSetupDisclosure.svelte";

	export let connection;

	const toastStore = getToastStore();

	$: neutral = neutralButton($modeCurrent);
	$: primary = primaryButton($modeCurrent);
	$: primaryVar = primaryVariant($modeCurrent);
	let address = connection.url ?? "";
	let port = portText(connection.port);
	let manageError = "";

	async function saveAddress() {
		manageError = "";
		try {
			await setAddress(connection.id, address.trim());
		} catch (err) {
			manageError = errorText(err);
		}
	}

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

	async function checkForUpdate() {
		const result = await serviceUpdateStore.check();
		const toast = serviceUpdateCheckToast(result, connection.name);
		if (toast) toastStore.trigger({ ...toast, timeout: 4000 });
	}

	function handleUpdateAction() {
		if (!updateAction) return;
		if (updateAction.kind === "restart") connectionStore.restart();
		else if (updateAction.kind === "carried") installCarried();
		else if (updateAction.kind === "install") serviceUpdateStore.install();
		else if (updateAction.kind === "check") checkForUpdate();
	}

	async function switchChannel(channel) {
		if (!channelControls || channelControls.disabled || channelControls.channel === channel) return;
		await serviceUpdateStore.setChannel(channel);
	}

	async function reinstallService() {
		if (!channelControls || channelControls.disabled) return;
		await serviceUpdateStore.reinstall();
	}

	async function changeCLIPath() {
		try {
			await localCLIStore.browseAndUsePath();
		} catch (err) {
			toastError(toastStore, "CLI path not changed", err);
		}
	}

	async function clearCLIPath() {
		try {
			await localCLIStore.clearPath();
		} catch (err) {
			toastError(toastStore, "CLI path not reset", err);
		}
	}

	async function installCarried() {
		await installCarriedWithToast(toastStore, {
			connectionId: connection.id,
			isActive,
			instanceRunning: Boolean(instance?.running),
		});
		if (!isActive && local) local.refresh(isActive, state.phase);
	}

	function setWhenQuitting(value) {
		localCLIStore
			.setWhenQuitting(value)
			.catch((error) => toastError(toastStore, "When quitting not saved", error));
	}

	onMount(() => {
		if (!$mobile && connection.kind === "local" && !$localCLIStore.loaded) {
			localCLIStore.load();
		}
	});

	$: added = connection.kind === "local" && connection.id !== "local";
	$: isDesktopLocal = !$mobile && connection.kind === "local";
	$: localCLI = $localCLIStore;
	$: whenQuitting = LOCAL_QUIT_CHOICES.some(([value]) => value === $marasiConfig?.WhenQuitting)
		? $marasiConfig.WhenQuitting
		: "ask";
	$: state = $connectionStore;
	$: update = $serviceUpdateStore;
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
	$: serviceMeta = reached ? serviceMetaText(state, update) : null;
	$: statusTone = isActive && state.restarting ? "bg-warning-500" : phaseTone(phase);
	$: statusLabel = isActive && state.restarting ? "Restarting" : phaseLabel(phase);
	$: statusPulsing = phase === "reconnecting" || (isActive && state.restarting);

	$: showRestartConfirm = isActive && phase === "connected" && state.restartAsk;
	$: restartCopy = restartConfirmCopy(connection);
	$: activeStopAsk = isActive && phase === "connected" && state.stopAsk;
	$: inactiveStopAsk = !isActive && Boolean(local && instance?.stopAsk);
	$: showStopConfirm = activeStopAsk || inactiveStopAsk;
	$: stopCopy = stopConfirmCopy(connection);
	$: stopErrorText = isActive ? state.stopError : (instance?.error || null);

	$: carriedUpgrade =
		isActive && isDesktopLocal
			? proactiveCarriedUpgrade({
					mobile: $mobile,
					connectionState: state,
					updateState: update,
					carried: localCLI.carried,
					cli: localCLI.cli,
					dismissedVersion: localCLI.dismissedVersion,
				})
			: null;
	$: channelMismatch =
		isActive && isDesktopLocal
			? localChannelMismatch({
					mobile: $mobile,
					connectionState: state,
					updateState: update,
					appChannel: localCLI.appChannel,
				})
			: null;

	$: updateAction =
		isActive && phase === "connected"
			? serviceUpdateAction(state, update, { carriedUpgrade, installingCarried: localCLI.installing })
			: null;
	$: updateInstalling = isActive && phase === "connected" && (update.install?.state === "running" || update.startingInstall);
	$: updateProgress = serviceUpdateProgress(
		{ ...update, restartRequired: update.restartRequired || state.restartRequired },
		connection.name,
	);
	$: availableNotes = formatServiceNotes(update.available);
	$: slot = contextualSlotKind({
		isActive,
		phase,
		connectionState: state,
		updateState: update,
		showRestartConfirm,
		showStopConfirm,
		isCLIMissing,
		isOutdated,
		stopErrorText,
		carriedUpgrade,
		channelMismatch,
	});

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

	$: channelControls = isActive && phase === "connected" ? serviceChannelControls(state, update) : null;
	$: showManualCarried = isDesktopLocal && offersCarriedCLI(localCLI.carried, localCLI.cli);
	$: showSetup = Boolean(channelControls || (isDesktopLocal && !isCLIMissing));
	$: setup = setupDisclosure(connection, {
		channel: resolvedServiceChannel({ isActive, connectionState: state, updateState: update }),
		version: isActive ? state.version : null,
		whenQuitting: isDesktopLocal ? whenQuitting : null,
		mobile: $mobile,
	});

	const row = "settings-row flex items-center justify-between gap-4 py-2.5 border-b border-surface-300 dark:border-surface-600";
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
				{#if updateAction}
					<button
						type="button"
						class="{updateAction.primary ? primary : neutral} justify-center"
						disabled={updateAction.disabled}
						data-testid={updateAction.kind === "restart"
							? "connection-restart-apply"
							: updateAction.kind === "carried"
								? "connection-carried-action"
								: updateAction.kind === "install"
									? "connection-update-install"
									: updateAction.kind === "installing"
										? "connection-update-installing"
										: "connection-update-check"}
						on:click={handleUpdateAction}
					>
						{#if updateAction.kind === "restart"}
							<RotateCw size={14} class={updateAction.spinning ? "animate-spin" : ""} />
						{:else if updateAction.kind === "carried" || updateAction.kind === "install" || updateAction.kind === "installing"}
							<Download size={14} />
						{:else}
							<RefreshCw size={14} class={updateAction.spinning ? "animate-spin" : ""} />
						{/if}
						<span>{updateAction.label}</span>
					</button>
				{/if}
				{#if state.restartSupported && !updateAction?.hideNeutralRestart}
					<button
						type="button"
						class="{neutral} justify-center"
						disabled={state.busy !== null || state.restarting || state.restartConfirming || updateInstalling}
						data-testid="connection-restart"
						on:click={() => connectionStore.restart()}
					>
						<RotateCw size={14} class={state.restarting ? "animate-spin" : ""} />
						<span>{state.restarting ? "Restarting…" : "Restart"}</span>
					</button>
				{/if}
				<button
					type="button"
					class="{neutral} justify-center"
					disabled={state.busy !== null || state.restarting || state.restartConfirming || updateInstalling}
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
	<ConnectionContextSlot
		{slot}
		{connection}
		{state}
		{update}
		{localCLI}
		{primary}
		{neutral}
		{restartCopy}
		{stopCopy}
		{stopErrorText}
		{updateProgress}
		{availableNotes}
		{carriedUpgrade}
		{channelMismatch}
		{channelControls}
		onCancelRestart={() => connectionStore.cancelRestart()}
		onConfirmRestart={() => connectionStore.confirmRestart()}
		onCancelStop={cancelStop}
		onConfirmStop={confirmStop}
		onEnterPassword={(pw) => connectionStore.enterPassword(pw)}
		onCLIFound={(cli) => localCLIStore.setCLI(cli)}
		onCancelUpdate={() => serviceUpdateStore.cancel()}
		onDismissUpdateError={() => serviceUpdateStore.dismissError()}
		onDismissCarried={(version) => localCLIStore.dismissCarried(version)}
		onInstallCarried={installCarried}
		onSwitchChannel={switchChannel}
	/>

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

	<!-- 5. Collapsed setup disclosure -->
	{#if showSetup}
		<ConnectionSetupDisclosure
			{connection}
			{setup}
			{channelControls}
			{isDesktopLocal}
			{localCLI}
			{showManualCarried}
			{whenQuitting}
			connectionBusy={state.busy !== null || state.restarting || state.restartConfirming}
			{primary}
			{neutral}
			{primaryVar}
			{row}
			onSwitchChannel={switchChannel}
			onReinstall={reinstallService}
			onChangeCLIPath={changeCLIPath}
			onClearCLIPath={clearCLIPath}
			onInstallCarried={installCarried}
			onSetWhenQuitting={setWhenQuitting}
		/>
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
