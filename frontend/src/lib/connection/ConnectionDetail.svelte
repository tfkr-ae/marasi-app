<script>
	// One connection's details: its status, the service's project, version
	// and API level, and the API level warning (with Update CLI on the local
	// connection). The Connections modal shows it
	// compact; Settings → Connection in the Settings row layout (`rows`).
	// Another connection offers Switch; a refused password asks for it; a
	// remote has its address and Remove. Every connection offers Stop, which
	// asks first for a remote ("Stop <name>?": the app can't start it again)
	// or a run the app doesn't own; once stopped, "Marasi stopped" with Start
	// for a local connection and Retry for a remote. The password and sharing rows
	// (ConnectionAccess) go after the service rows. A local connection the
	// researcher added (not Local) has its proxy port and Remove.
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import { neutralButton, primaryButton } from "../launchpad/format.js";
	import { projectName } from "../openProgress.js";
	import { connectionStore } from "../../stores/connectionStore.js";
	import { phaseLabel, phaseTone, removeBlock, whereText } from "./status.js";
	import { errorText, ownsRun, removeConnection, setAddress, setPort } from "./manage.js";
	import { PORT_RANGE_MESSAGE, parsePort, portText } from "./localPort.js";
	import { cliMissing, outdatedVersion } from "./cli.js";
	import CLISetup from "./CLISetup.svelte";
	import OutdatedInstance from "./OutdatedInstance.svelte";
	import UpdateCLI from "./UpdateCLI.svelte";
	import ConnectionAccess from "./ConnectionAccess.svelte";

	export let connection;
	/** Settings rows instead of the compact layout. */
	export let rows = false;

	$: neutral = neutralButton($modeCurrent);
	$: primary = primaryButton($modeCurrent);
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
	// Whether the app owns a run on this added local connection, read again
	// as the active connection or its phase changes (a switch away, a stop).
	let ownedRun = false;
	let ownedRead = 0;
	function readOwnedRun() {
		const read = ++ownedRead;
		ownsRun(connection.id).then((owned) => {
			if (read === ownedRead) ownedRun = owned;
		});
	}
	$: if (added) readOwnedRun(isActive, state.phase);
	$: removeHint = removeBlock({ isActive, ownedRun: added && ownedRun });
	const row = rows
		? "flex items-center justify-between gap-8 py-3 border-b border-surface-300 dark:border-surface-600"
		: "flex items-center justify-between gap-4 py-2 border-b border-surface-200 dark:border-surface-700";
</script>

<div class="text-sm" data-testid="connection-detail">
	<div class="flex items-center gap-3">
		<div class="min-w-0 flex-1">
			<h3 class="text-sm font-bold">{connection.name}</h3>
			<p class="font-mono text-2xs opacity-60">{whereText(connection, isActive ? state.instance : null)}</p>
		</div>
		<span class="flex items-center gap-1.5 text-xs" data-testid="connection-status">
			<span class="h-2 w-2 rounded-full {phaseTone(phase)}" class:animate-pulse={phase === "reconnecting"}></span>
			{phaseLabel(phase)}
		</span>
	</div>

	{#if isActive && state.apiWarning}
		<div class="mt-2 space-y-2 bg-warning-500/15 px-2 py-1 text-xs" data-testid="connection-api-warning">
			<p>{state.apiWarning}. Some features may not work.</p>
			{#if connection.kind === "local" && phase === "connected"}<UpdateCLI />{/if}
		</div>
	{/if}
	{#if !isActive}
		<div class="mt-3 flex justify-end">
			<button type="button" class={primary} data-testid="connection-switch" on:click={() => connectionStore.switchTo(connection.id)}>
				Switch
			</button>
		</div>
	{/if}
	{#if isActive && phase === "auth-failed"}
		<form class="mt-3 flex items-center gap-3 bg-error-500/10 p-3" data-testid="connection-password-prompt" on:submit|preventDefault={enterPassword}>
			<p class="text-xs">{state.error}</p>
			<input class="input h-8 min-w-0 flex-1 py-1 text-xs" type="password" placeholder="Password" data-testid="connection-password" bind:value={password} />
			<button type="submit" class={primary} disabled={!password}>Connect</button>
		</form>
		{#if passwordError}<p class="mt-1 text-xs text-error-600 dark:text-error-400">{passwordError}</p>{/if}
	{/if}
	{#if isActive && phase === "failed" && connection.kind === "local" && cliMissing(state.error)}
		<CLISetup />
	{:else if isActive && phase === "failed" && connection.kind === "local" && outdatedVersion(state.error) !== null}
		<div class="mt-3 bg-warning-500/15 p-3">
			<OutdatedInstance error={state.error} />
		</div>
	{:else if isActive && phase === "stopped"}
		<div class="mt-3 flex items-center gap-3 bg-surface-500/10 p-3" data-testid="connection-stopped">
			<p class="min-w-0 flex-1 text-xs">Marasi stopped</p>
			{#if connection.kind === "local"}
				<button type="button" class={primary} data-testid="connection-detail-start" on:click={() => connectionStore.startInstance()}>Start</button>
			{:else}
				<button type="button" class={neutral} on:click={() => connectionStore.retry()}>Retry</button>
			{/if}
		</div>
	{:else if isActive && phase === "failed"}
		<div class="mt-3 flex items-center gap-3 bg-error-500/10 p-3">
			<p class="min-w-0 flex-1 break-words text-xs">{state.error}</p>
			<button type="button" class={neutral} on:click={() => connectionStore.retry()}>Retry</button>
		</div>
	{/if}

	{#if reached}
		<div class="mt-3 border-t border-surface-200 dark:border-surface-700">
			<div class={row}>
				<div>
					<p>Project</p>
					<p class="text-xs opacity-70">Open in the service</p>
				</div>
				<div class="min-w-0 text-right">
					<p class="truncate font-semibold" data-testid="connection-project">{projectName(state.project)}</p>
					<p class="truncate font-mono text-2xs opacity-60" title={state.project}>{state.project}</p>
				</div>
			</div>
			<div class={row}>
				<div>
					<p>Service version</p>
					<p class="text-xs opacity-70">The Marasi the service runs</p>
				</div>
				<p class="font-mono text-xs" data-testid="connection-version">{state.version}</p>
			</div>
			<div class={row}>
				<div>
					<p>API level</p>
					<p class="text-xs opacity-70">The control API the service speaks</p>
				</div>
				<p class="font-mono text-xs" data-testid="connection-api">{state.api ?? "none"}</p>
			</div>
			{#if phase === "connected"}
				<div class={row}>
					<div>
						{#if state.stopAsk && connection.kind === "remote"}
							<p data-testid="connection-stop-title">Stop {connection.name}?</p>
							<p class="text-xs opacity-70" data-testid="connection-stop-hint">The app can't start it again.</p>
						{:else}
							<p>Instance</p>
							<p class="text-xs opacity-70" data-testid="connection-stop-hint">
								{state.stopAsk ? "Another program started it." : "Stop Marasi and its proxy"}
							</p>
						{/if}
					</div>
					<div class="flex items-center gap-2">
						{#if state.stopAsk}
							<button type="button" class={primary} data-testid="connection-stop-confirm" on:click={() => connectionStore.confirmStop()}>Stop</button>
							<button type="button" class={neutral} on:click={() => connectionStore.cancelStop()}>Cancel</button>
						{:else}
							<button type="button" class={neutral} disabled={state.busy !== null} data-testid="connection-stop" on:click={() => connectionStore.stop()}
								>{state.busy === "stop" ? "Stopping…" : "Stop"}</button
							>
						{/if}
					</div>
				</div>
				{#if state.stopError}<p class="mt-2 text-xs text-error-600 dark:text-error-400" role="alert">{state.stopError}</p>{/if}
			{/if}
		</div>
	{/if}

	{#if reached || !isActive}
		<ConnectionAccess {connection} {row} />
	{/if}

	{#if connection.kind === "remote"}
		<div class="mt-3 border-t border-surface-200 dark:border-surface-700">
			<div class={row}>
				<div>
					<p>Address</p>
					<p class="text-xs opacity-70">The service's control listener</p>
				</div>
				<form class="flex min-w-0 items-center gap-2" on:submit|preventDefault={saveAddress}>
					<input class="input h-8 w-56 py-1 font-mono text-xs" data-testid="connection-address" bind:value={address} />
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
		<div class="mt-3 border-t border-surface-200 dark:border-surface-700" data-testid="connection-local-manage">
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
