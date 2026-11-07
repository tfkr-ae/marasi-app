<script>
	// One connection's details: its status, the service's project and
	// version, and the version warning. The Connections modal shows it
	// compact; Settings → Connection in the Settings row layout (`rows`).
	// The password and sharing rows (ticket 15) go after the service rows.
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import { neutralVariant } from "../launchpad/format.js";
	import { projectName } from "../openProgress.js";
	import { connectionStore } from "../../stores/connectionStore.js";
	import { phaseLabel, phaseTone, whereText } from "./status.js";
	import { cliMissing } from "./cli.js";
	import CLISetup from "./CLISetup.svelte";

	export let connection;
	/** Settings rows instead of the compact layout. */
	export let rows = false;

	$: neutral = `btn btn-sm rounded-none ${neutralVariant($modeCurrent)}`;
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
	{#if isActive && phase === "failed" && connection.kind === "local" && cliMissing(state.error)}
		<CLISetup />
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
</div>
