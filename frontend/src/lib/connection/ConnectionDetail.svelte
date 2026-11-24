<script>
	// One connection's details in the Variant E action-first layout:
	// 1. Compact identity header: name, status dot + label, host/instance/OS,
	//    and Marasi <version> (<channel>) · API <level> when reached.
	// 2. Top action bar directly below the header (Check update / Update to
	//    <version> / Restart to apply, Restart, Stop / Switch / Start / Retry).
	// 3. Single contextual slot directly beneath the action bar (at most one
	//    card, strict precedence: inline Restart/Stop confirmation, inline
	//    4-step update tracker while installing or waiting to restart, errors,
	//    available release notes + Release page link, or connection/API notice).
	// 4. Operational rows: Project and Access (ConnectionAccess).
	// 5. Collapsed setup disclosure shell (ready for channel, reinstall, and
	//    desktop local CLI / quit controls), followed by connection management
	//    rows (Address/Remove on remotes, Proxy port/Remove on added locals).
	import { onMount } from "svelte";
	import { getToastStore, modeCurrent, ProgressBar } from "@skeletonlabs/skeleton";
	import { Check, ChevronDown, ChevronRight, Download, ExternalLink, Power, RefreshCw, RotateCw } from "lucide-svelte";
	import { SetFlag } from "../bindings/github.com/tfkr-ae/marasi-app/app.js";
	import { neutralButton, primaryButton, primaryVariant } from "../launchpad/format.js";
	import { projectName } from "../openProgress.js";
	import { mobile } from "../platform.js";
	import { openURL } from "../runtime.js";
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
		reinstallConfirmCopy,
		restartConfirmCopy,
		SERVICE_CHANNELS,
		serviceChannelControls,
		serviceMetaText,
		serviceUpdateAction,
		serviceUpdateCheckToast,
		serviceUpdateProgress,
		setupDisclosure,
		stopConfirmCopy,
	} from "./detail.js";
	import { errorText, localInstanceControl, removeConnection, setAddress, setPort } from "./manage.js";
	import { PORT_RANGE_MESSAGE, parsePort, portText } from "./localPort.js";
	import { cliMissing, cliSourceLabel, offersCarriedCLI, outdatedVersion } from "./cli.js";
	import CLISetup from "./CLISetup.svelte";
	import OutdatedInstance from "./OutdatedInstance.svelte";
	import UpdateCLI from "./UpdateCLI.svelte";
	import ConnectionAccess from "./ConnectionAccess.svelte";

	export let connection;
	/** Settings rows instead of the compact modal spacing. */
	export let rows = false;

	const toastStore = getToastStore();

	$: neutral = neutralButton($modeCurrent);
	$: primary = primaryButton($modeCurrent);
	$: primaryVar = primaryVariant($modeCurrent);
	let setupOpen = false;
	let reinstallAsk = false;
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
		reinstallAsk = false;
		await serviceUpdateStore.setChannel(channel);
	}

	async function confirmReinstall() {
		if (!channelControls || channelControls.disabled) return;
		reinstallAsk = false;
		await serviceUpdateStore.reinstall();
	}

	async function changeCLIPath() {
		try {
			await localCLIStore.browseAndUsePath();
		} catch (err) {
			toastStore.trigger({ message: String(err?.message ?? err), background: "variant-filled-error" });
		}
	}

	async function clearCLIPath() {
		try {
			await localCLIStore.clearPath();
		} catch (err) {
			toastStore.trigger({ message: String(err?.message ?? err), background: "variant-filled-error" });
		}
	}

	async function installCarried() {
		try {
			const outcome = await localCLIStore.installCarried({
				connectionState: state,
				connectionId: connection.id,
				isActive,
				instanceRunning: Boolean(instance?.running),
				restartService: () => connectionStore.restart(),
				retryConnection: () => (phase === "failed" ? connectionStore.retry() : connectionStore.retryNow()),
			});
			if (!isActive && local) local.refresh(isActive, state.phase);
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

	function setWhenQuitting(value) {
		SetFlag("when_quitting", value)
			.then((config) => marasiConfig.set(config))
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
	$: serviceMeta = reached ? serviceMetaText(state) : null;
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
	$: reinstallCopy = channelControls ? reinstallConfirmCopy(channelControls.channel, connection.name) : null;
	$: if (!channelControls) reinstallAsk = false;

	$: showManualCarried = isDesktopLocal && offersCarriedCLI(localCLI.carried, localCLI.cli);
	$: showSetup = Boolean(channelControls || (isDesktopLocal && !isCLIMissing));
	$: setup = setupDisclosure(connection, {
		channel: (isActive ? update.channel : null) ?? state.channel,
		version: isActive ? state.version : null,
		whenQuitting: isDesktopLocal ? whenQuitting : null,
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

	<!-- 3. Single contextual slot directly below the action bar (at most one card) -->
	{#if slot === "restart-confirm"}
		<div
			class="mt-3 flex flex-wrap items-center justify-between gap-2 border-l-4 border-warning-500 bg-warning-500/15 px-3 py-2.5 text-xs"
			data-testid="connection-context"
		>
			<div class="min-w-0">
				<p class="font-semibold" data-testid="connection-restart-title">{restartCopy.title}</p>
				<p class="opacity-80" data-testid="connection-restart-hint">{restartCopy.detail}</p>
			</div>
			<div class="connection-context-actions flex items-center gap-2">
				<button type="button" class={neutral} data-testid="connection-restart-cancel" on:click={() => connectionStore.cancelRestart()}>Cancel</button>
				<button type="button" class={primary} data-testid="connection-restart-confirm" on:click={() => connectionStore.confirmRestart()}>Restart</button>
			</div>
		</div>
	{:else if slot === "stop-confirm"}
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
	{:else if slot === "auth-failed"}
		<div class="mt-3" data-testid="connection-context">
			<form class="flex items-center gap-3 border-l-4 border-error-500 bg-error-500/10 p-3" data-testid="connection-password-prompt" on:submit|preventDefault={enterPassword}>
				<p class="text-xs">{state.error}</p>
				<input class="input h-8 min-w-0 flex-1 py-1 text-xs" type="password" placeholder="Password" data-testid="connection-password" bind:value={password} />
				<button type="submit" class={primary} disabled={!password}>Connect</button>
			</form>
			{#if passwordError}<p class="mt-1 text-xs text-error-600 dark:text-error-400">{passwordError}</p>{/if}
		</div>
	{:else if slot === "cli-missing"}
		<div class="mt-3" data-testid="connection-context">
			<CLISetup on:found={(event) => localCLIStore.setCLI(event.detail)} />
		</div>
	{:else if slot === "outdated"}
		<div class="mt-3 border-l-4 border-warning-500 bg-warning-500/15 p-3" data-testid="connection-context">
			<OutdatedInstance error={state.error} />
		</div>
	{:else if slot === "stopped"}
		<div class="mt-3 border-l-4 border-surface-400 bg-surface-500/10 px-3 py-2 text-xs" data-testid="connection-stopped">
			Marasi stopped. {connection.kind === "local" ? "Start it again to resume working." : "Start it on the remote host, then retry."}
		</div>
	{:else if slot === "failed"}
		<div class="mt-3 border-l-4 border-error-500 bg-error-500/10 px-3 py-2 text-xs" role="alert" data-testid="connection-context">
			<p class="min-w-0 break-words">{state.error}</p>
		</div>
	{:else if slot === "installing" || slot === "restart-required"}
		<div
			class="mt-3 space-y-3 border-l-4 border-primary-500 bg-surface-100 p-3 text-xs dark:bg-surface-800"
			data-testid={slot === "installing" ? "connection-update-progress" : "connection-update-restart"}
		>
			<div class="flex items-center justify-between gap-2">
				<span class="min-w-0 truncate font-semibold" data-testid="connection-update-heading">{updateProgress.heading}</span>
				{#if slot === "installing" && updateProgress.cancellable}
					<button
						type="button"
						class="{neutral} shrink-0 py-0.5"
						disabled={update.cancelling}
						data-testid="connection-update-cancel"
						on:click={() => serviceUpdateStore.cancel()}
					>
						{update.cancelling ? "Cancelling…" : "Cancel"}
					</button>
				{/if}
			</div>

			<ol class="grid grid-cols-4 gap-1.5 text-3xs sm:gap-2" aria-label="Update steps">
				{#each updateProgress.steps as label, i (label)}
					<li class="flex min-w-0 items-center gap-1.5" aria-current={i === updateProgress.stepIndex ? "step" : undefined}>
						<span
							class="flex h-4 w-4 shrink-0 items-center justify-center font-bold {i < updateProgress.stepIndex
								? 'bg-primary-500 text-white'
								: i === updateProgress.stepIndex
									? 'ring-2 ring-primary-500'
									: 'bg-surface-300 dark:bg-surface-600'}"
						>
							{#if i < updateProgress.stepIndex}<Check size={10} />{:else}{i + 1}{/if}
						</span>
						<span class="truncate {i === updateProgress.stepIndex ? 'font-semibold' : i < updateProgress.stepIndex ? '' : 'opacity-55'}">{label}</span>
					</li>
				{/each}
			</ol>

			{#if slot === "installing"}
				<ProgressBar value={updateProgress.percent} max={100} height="h-1.5" meter="bg-primary-500" />
			{:else}
				<p class="opacity-75">Restart {connection.name} to switch onto the new version. Your open project stays intact.</p>
				{#if state.restartError}
					<p class="text-error-700 dark:text-error-300" role="alert" data-testid="connection-restart-error">{state.restartError}</p>
				{:else if update.error}
					<div class="flex flex-wrap items-center justify-between gap-2 text-error-700 dark:text-error-300" role="alert" data-testid="connection-update-error">
						<span class="min-w-0 flex-1 break-words">{update.error.message}</span>
						<div class="flex shrink-0 items-center gap-3">
							{#if update.error.page}
								<button
									type="button"
									class="inline-flex items-center gap-1 underline opacity-85 hover:opacity-100"
									data-testid="connection-update-error-page"
									on:click={() => openURL(update.error.page)}
								>
									<span>Release page</span><ExternalLink size={11} />
								</button>
							{/if}
							<button
								type="button"
								class="underline opacity-75 hover:opacity-100"
								data-testid="connection-update-error-dismiss"
								on:click={() => serviceUpdateStore.dismissError()}
							>
								Dismiss
							</button>
						</div>
					</div>
				{/if}
			{/if}
		</div>
	{:else if slot === "carried-upgrade" && carriedUpgrade}
		<div
			class="mt-3 flex flex-wrap items-center justify-between gap-2 border-l-4 border-primary-500 bg-primary-500/10 px-3 py-2.5 text-xs"
			data-testid="connection-carried-upgrade"
		>
			<div class="min-w-0">
				<p class="font-semibold">Marasi CLI <span class="font-mono">{carriedUpgrade.version}</span> is included with this app</p>
				<p class="opacity-75">Update {connection.name} offline and restart in one step.</p>
			</div>
			<div class="connection-context-actions flex items-center gap-2">
				<button
					type="button"
					class={neutral}
					disabled={localCLI.installing}
					data-testid="connection-carried-dismiss"
					on:click={() => localCLIStore.dismissCarried(carriedUpgrade.version)}
				>
					Dismiss
				</button>
				<button
					type="button"
					class={primary}
					disabled={localCLI.installing || state.busy !== null || state.restarting || state.restartConfirming}
					data-testid="connection-carried-install"
					on:click={installCarried}
				>
					{localCLI.installing ? "Installing…" : "Install & restart"}
				</button>
			</div>
		</div>
	{:else if slot === "available"}
		<div
			class="mt-3 space-y-2 border-l-4 border-primary-500 bg-surface-100 p-3 text-xs dark:bg-surface-800"
			data-testid="connection-update-available"
		>
			<div class="flex flex-wrap items-center justify-between gap-2">
				<span class="font-semibold">
					Marasi {update.available.version} available{#if update.available.channel} ({update.available.channel}){/if}
				</span>
				{#if update.available.page}
					<button
						type="button"
						class="inline-flex items-center gap-1 underline opacity-75 hover:opacity-100"
						data-testid="connection-update-page"
						on:click={() => openURL(update.available.page)}
					>
						<span>Release page</span><ExternalLink size={11} />
					</button>
				{/if}
			</div>
			{#if availableNotes}
				<pre class="whitespace-pre-wrap break-words font-sans opacity-85" data-testid="connection-update-notes">{availableNotes}</pre>
			{/if}
			{#if update.error}
				<div class="space-y-1 border-t border-surface-300 pt-2 text-error-700 dark:border-surface-600 dark:text-error-300" role="alert" data-testid="connection-update-error">
					<div class="flex flex-wrap items-start justify-between gap-2">
						<span class="min-w-0 flex-1 break-words font-semibold">{update.error.message}</span>
						<button
							type="button"
							class="shrink-0 underline opacity-75 hover:opacity-100"
							data-testid="connection-update-error-dismiss"
							on:click={() => serviceUpdateStore.dismissError()}
						>
							Dismiss
						</button>
					</div>
					{#if update.error.installPath}
						<p class="break-all font-mono text-2xs opacity-85" data-testid="connection-update-error-path">
							Install path: {update.error.installPath}
						</p>
					{/if}
				</div>
			{:else if state.restartError}
				<p class="border-t border-surface-300 pt-2 text-error-700 dark:border-surface-600 dark:text-error-300" role="alert" data-testid="connection-restart-error">
					{state.restartError}
				</p>
			{/if}
		</div>
	{:else if slot === "channel-mismatch" && channelMismatch}
		<div
			class="mt-3 flex flex-wrap items-center justify-between gap-2 border-l-4 border-warning-500 bg-warning-500/15 px-3 py-2 text-xs"
			data-testid="connection-channel-mismatch"
		>
			<span>App is <strong>{channelMismatch.appChannel}</strong>; Local is <strong>{channelMismatch.serviceChannel}</strong>.</span>
			<button
				type="button"
				class={neutral}
				disabled={Boolean(channelControls?.disabled)}
				data-testid="connection-channel-mismatch-switch"
				on:click={() => switchChannel(channelMismatch.appChannel)}
			>
				Switch Local to {channelMismatch.appChannel}
			</button>
		</div>
	{:else if slot === "stop-error"}
		<div class="mt-3 border-l-4 border-error-500 bg-error-500/15 px-3 py-2 text-xs text-error-700 dark:text-error-300" role="alert" data-testid="connection-context">
			{stopErrorText}
		</div>
	{:else if slot === "install-error"}
		<div
			class="mt-3 space-y-1.5 border-l-4 border-error-500 bg-error-500/15 px-3 py-2.5 text-xs text-error-700 dark:text-error-300"
			role="alert"
			data-testid="connection-update-error"
		>
			<div class="flex flex-wrap items-start justify-between gap-2">
				<p class="min-w-0 flex-1 break-words font-semibold">{update.error.message}</p>
				<div class="flex shrink-0 items-center gap-3">
					{#if update.error.page}
						<button
							type="button"
							class="inline-flex items-center gap-1 underline opacity-85 hover:opacity-100"
							data-testid="connection-update-error-page"
							on:click={() => openURL(update.error.page)}
						>
							<span>Release page</span><ExternalLink size={11} />
						</button>
					{/if}
					<button
						type="button"
						class="underline opacity-75 hover:opacity-100"
						data-testid="connection-update-error-dismiss"
						on:click={() => serviceUpdateStore.dismissError()}
					>
						Dismiss
					</button>
				</div>
			</div>
			{#if update.error.installPath}
				<p class="break-all font-mono text-2xs opacity-85" data-testid="connection-update-error-path">
					Install path: {update.error.installPath}
				</p>
			{/if}
		</div>
	{:else if slot === "restart-error"}
		<div class="mt-3 border-l-4 border-error-500 bg-error-500/15 px-3 py-2 text-xs text-error-700 dark:text-error-300" role="alert" data-testid="connection-restart-error">
			{state.restartError}
		</div>
	{:else if slot === "api-warning"}
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

	<!-- 5. Collapsed setup disclosure (channel, reinstall, and desktop local CLI / quit controls) -->
	{#if showSetup}
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
					{#if channelControls}
						<div class={row}>
							<div>
								<p>Update channel</p>
								<p class="text-xs opacity-70">Builds {connection.name} checks</p>
							</div>
							<div class="settings-control flex w-44 text-xs" role="radiogroup" aria-label="Update channel">
								{#each SERVICE_CHANNELS as [value, label]}
									<button
										type="button"
										role="radio"
										aria-checked={channelControls.channel === value}
										disabled={channelControls.disabled}
										class="flex-1 px-3 py-1 {channelControls.channel === value
											? primaryVar
											: 'bg-surface-200 hover:bg-surface-300 dark:bg-surface-700 dark:hover:bg-surface-600'}"
										data-testid="connection-channel-{value}"
										on:click={() => switchChannel(value)}
									>
										{label}
									</button>
								{/each}
							</div>
						</div>
						<div class="py-2.5 {isDesktopLocal ? 'border-b border-surface-300 dark:border-surface-600' : ''}">
							{#if reinstallAsk && reinstallCopy}
								<div
									class="flex flex-wrap items-center justify-between gap-2 border-l-4 border-warning-500 bg-warning-500/15 px-3 py-2.5 text-xs"
									data-testid="connection-reinstall-confirm-box"
								>
									<div class="min-w-0">
										<p class="font-semibold" data-testid="connection-reinstall-confirm-title">{reinstallCopy.title}</p>
										<p class="opacity-80" data-testid="connection-reinstall-confirm-detail">{reinstallCopy.detail}</p>
									</div>
									<div class="connection-context-actions flex items-center gap-2">
										<button
											type="button"
											class={neutral}
											data-testid="connection-reinstall-cancel"
											on:click={() => (reinstallAsk = false)}
										>
											Cancel
										</button>
										<button
											type="button"
											class={primary}
											disabled={channelControls.disabled}
											data-testid="connection-reinstall-confirm"
											on:click={confirmReinstall}
										>
											Reinstall
										</button>
									</div>
								</div>
							{:else}
								<div class="settings-row flex items-center justify-between gap-4">
									<div>
										<p data-testid="connection-reinstall-label">{channelControls.reinstallLabel}</p>
										<p class="text-xs opacity-70">Replaces the installed build even when older</p>
									</div>
									<button
										type="button"
										class={neutral}
										disabled={channelControls.disabled}
										data-testid="connection-reinstall"
										on:click={() => (reinstallAsk = true)}
									>
										Reinstall
									</button>
								</div>
							{/if}
						</div>
					{/if}

					{#if isDesktopLocal}
						<div class={row} data-testid="connection-cli-path">
							<div class="min-w-0 flex-1">
								<p>Local CLI path</p>
								{#if localCLI.cli?.found}
									<p class="truncate font-mono text-2xs opacity-65" title={localCLI.cli.path} data-testid="connection-cli-location">
										{localCLI.cli.path} · {cliSourceLabel(localCLI.cli.source)}
									</p>
								{:else if localCLI.loaded}
									<p class="text-xs opacity-70">Not installed</p>
								{/if}
								{#if localCLI.cli?.problem}
									<p class="mt-1 bg-warning-500/15 px-2 py-0.5 text-2xs break-words">{localCLI.cli.problem}</p>
								{/if}
							</div>
							<div class="flex shrink-0 items-center gap-2">
								{#if localCLI.cli?.source === "custom"}
									<button
										type="button"
										class={neutral}
										disabled={localCLI.changingPath || localCLI.installing}
										data-testid="connection-cli-use-path"
										on:click={clearCLIPath}
									>
										Use PATH
									</button>
								{/if}
								<button
									type="button"
									class={neutral}
									disabled={localCLI.changingPath || localCLI.installing}
									data-testid="connection-cli-change"
									on:click={changeCLIPath}
								>
									Change
								</button>
							</div>
						</div>

						{#if showManualCarried}
							<div class={row} data-testid="connection-cli-carried">
								<div class="min-w-0 flex-1">
									<p>Carried CLI</p>
									<p class="font-mono text-2xs opacity-65" data-testid="connection-cli-carried-version">
										{localCLI.carried.version}{#if localCLI.carried.channel} ({localCLI.carried.channel}){/if}
									</p>
								</div>
								<button
									type="button"
									class={neutral}
									disabled={localCLI.installing || localCLI.changingPath || state.busy !== null || state.restarting || state.restartConfirming}
									data-testid="connection-cli-carried-install"
									on:click={installCarried}
								>
									{localCLI.installing ? "Installing…" : "Install & restart"}
								</button>
							</div>
						{/if}

						<div class="settings-row flex items-center justify-between gap-4 py-2.5" data-testid="connection-when-quitting">
							<div>
								<p>When quitting Marasi App</p>
								<p class="text-xs opacity-70">Local instances this app started</p>
							</div>
							<div class="settings-control flex w-60 shrink-0 text-xs" role="radiogroup" aria-label="When quitting Marasi App">
								{#each LOCAL_QUIT_CHOICES as [value, label]}
									<button
										type="button"
										role="radio"
										aria-checked={whenQuitting === value}
										class="flex-1 whitespace-nowrap px-2 py-1 {whenQuitting === value
											? primaryVar
											: 'bg-surface-200 hover:bg-surface-300 dark:bg-surface-700 dark:hover:bg-surface-600'}"
										data-testid="connection-quit-{value}"
										on:click={() => setWhenQuitting(value)}
									>
										{label}
									</button>
								{/each}
							</div>
						</div>
					{/if}
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
