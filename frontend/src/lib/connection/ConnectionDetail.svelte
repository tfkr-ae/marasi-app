<script>
	// One connection's details: its status, the service's project and
	// version, and the version warning. The Connections modal shows it
	// compact; Settings → Connection in the Settings row layout (`rows`).
	// Another connection offers Switch; a refused password asks for it; a
	// remote has its address and Remove. The password and sharing rows
	// (ConnectionAccess) go after the service rows.
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import { neutralButton, primaryButton } from "../launchpad/format.js";
	import { projectName } from "../openProgress.js";
	import { connectionStore } from "../../stores/connectionStore.js";
	import { phaseLabel, phaseTone, whereText } from "./status.js";
	import { errorText, removeConnection, setAddress } from "./manage.js";
	import { cliMissing, outdatedVersion } from "./cli.js";
	import CLISetup from "./CLISetup.svelte";
	import OutdatedInstance from "./OutdatedInstance.svelte";
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
	async function remove() {
		manageError = "";
		try {
			await removeConnection(connection.id);
		} catch (err) {
			manageError = errorText(err);
		}
	}
	$: state = $connectionStore;
	$: isActive = connection.id === state.connection.id;
	$: phase = isActive ? state.phase : "idle";
	$: reached = isActive && state.version !== null;
	const row = rows
		? "flex items-center justify-between gap-8 py-3 border-b border-surface-300 dark:border-surface-600"
		: "flex items-center justify-between gap-4 py-2 border-b border-surface-200 dark:border-surface-700";
</script>

<div class="text-sm" data-testid="connection-detail">
	<div class="flex items-start gap-3">
		<div class="min-w-0 flex-1">
			<h3 class="text-sm font-bold">{connection.name}</h3>
			<p class="font-mono text-2xs opacity-60">{whereText(connection, isActive ? state.instance : null)}</p>
		</div>
		<span class="flex items-center gap-1.5 text-xs" data-testid="connection-status">
			<span class="h-2 w-2 rounded-full {phaseTone(phase)}" class:animate-pulse={phase === "reconnecting"}></span>
			{phaseLabel(phase)}
		</span>
	</div>

	{#if isActive && state.versionWarning}
		<p class="mt-2 bg-warning-500/15 px-2 py-1 text-xs" data-testid="connection-version-warning">
			{state.versionWarning}. Some features may not work.
		</p>
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
					<p class="text-xs opacity-70">{isActive ? "Switch away first" : "Forget it and its password"}</p>
				</div>
				<button type="button" class={neutral} disabled={isActive} data-testid="connection-remove" on:click={remove}>Remove</button>
			</div>
		</div>
		{#if manageError}<p class="mt-2 text-xs text-error-600 dark:text-error-400" data-testid="connection-manage-error">{manageError}</p>{/if}
	{/if}
</div>
