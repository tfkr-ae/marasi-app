<script>
	// Single contextual slot directly below ConnectionDetail's top action bar
	// (strict 7-tier precedence, at most one card at a time). Higher-precedence
	// cards (restart-required, carried-upgrade, available, channel-mismatch)
	// also render any active update/restart error through ConnectionInlineError.
	import { ProgressBar } from "@skeletonlabs/skeleton";
	import { Check, ExternalLink } from "lucide-svelte";
	import { openURL } from "../runtime.js";
	import { contextualSlotErrors } from "./detail.js";
	import CLISetup from "./CLISetup.svelte";
	import ConnectionInlineError from "./ConnectionInlineError.svelte";
	import OutdatedInstance from "./OutdatedInstance.svelte";

	export let slot;
	export let connection;
	export let state;
	export let update;
	export let localCLI;
	export let primary;
	export let neutral;
	export let restartCopy;
	export let stopCopy;
	export let stopErrorText;
	export let updateProgress;
	export let availableNotes;
	export let carriedUpgrade;
	export let channelMismatch;
	export let channelControls;
	export let onCancelRestart;
	export let onConfirmRestart;
	export let onCancelStop;
	export let onConfirmStop;
	export let onEnterPassword;
	export let onCLIFound;
	export let onCancelUpdate;
	export let onDismissUpdateError;
	export let onDismissCarried;
	export let onInstallCarried;
	export let onSwitchChannel;

	let password = "";
	let passwordError = "";

	function submitPassword() {
		passwordError = onEnterPassword(password) ?? "";
		if (!passwordError) password = "";
	}

	$: slotErrors = contextualSlotErrors(slot, state, update);
</script>

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
			<button type="button" class={neutral} data-testid="connection-restart-cancel" on:click={onCancelRestart}>Cancel</button>
			<button type="button" class={primary} data-testid="connection-restart-confirm" on:click={onConfirmRestart}>Restart</button>
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
			<button type="button" class={neutral} on:click={onCancelStop}>Cancel</button>
			<button type="button" class={primary} data-testid="connection-stop-confirm" on:click={onConfirmStop}>Stop</button>
		</div>
	</div>
{:else if slot === "auth-failed"}
	<div class="mt-3" data-testid="connection-context">
		<form class="flex items-center gap-3 border-l-4 border-error-500 bg-error-500/10 p-3" data-testid="connection-password-prompt" on:submit|preventDefault={submitPassword}>
			<p class="text-xs">{state.error}</p>
			<input class="input h-8 min-w-0 flex-1 py-1 text-xs" type="password" placeholder="Password" data-testid="connection-password" bind:value={password} />
			<button type="submit" class={primary} disabled={!password}>Connect</button>
		</form>
		{#if passwordError}<p class="mt-1 text-xs text-error-600 dark:text-error-400">{passwordError}</p>{/if}
	</div>
{:else if slot === "cli-missing"}
	<div class="mt-3" data-testid="connection-context">
		<CLISetup on:found={(event) => onCLIFound(event.detail)} />
	</div>
{:else if slot === "outdated"}
	<div class="mt-3 border-l-4 border-warning-500 bg-warning-500/15 p-3" data-testid="connection-context">
		<OutdatedInstance error={state.error} />
	</div>
{:else if slot === "stopped"}
	<div class="mt-3 border-l-4 border-surface-400 bg-surface-500/10 px-3 py-2 text-xs" data-testid="connection-stopped">
		Marasi stopped. {connection.kind === "local" ? "Start to resume." : "Start it on the remote host, then retry."}
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
					on:click={onCancelUpdate}
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
			<p class="opacity-75">Restart to switch to the new version.</p>
			<ConnectionInlineError
				updateError={slotErrors.updateError}
				restartError={slotErrors.restartError}
				onDismiss={onDismissUpdateError}
			/>
		{/if}
	</div>
{:else if slot === "carried-upgrade" && carriedUpgrade}
	<div
		class="mt-3 space-y-2 border-l-4 border-primary-500 bg-primary-500/10 px-3 py-2.5 text-xs"
		data-testid="connection-carried-upgrade"
	>
		<div class="flex flex-wrap items-center justify-between gap-2">
			<div class="min-w-0">
				<p class="font-semibold">Marasi CLI <span class="font-mono">{carriedUpgrade.version}</span> included</p>
				<p class="opacity-75">Install offline and restart.</p>
			</div>
			<div class="connection-context-actions flex items-center gap-2">
				<button
					type="button"
					class={neutral}
					disabled={localCLI.installing}
					data-testid="connection-carried-dismiss"
					on:click={() => onDismissCarried(carriedUpgrade.version)}
				>
					Dismiss
				</button>
				<button
					type="button"
					class={primary}
					disabled={localCLI.installing || state.busy !== null || state.restarting || state.restartConfirming}
					data-testid="connection-carried-install"
					on:click={onInstallCarried}
				>
					{localCLI.installing ? "Installing…" : "Install & restart"}
				</button>
			</div>
		</div>
		<ConnectionInlineError
			updateError={slotErrors.updateError}
			restartError={slotErrors.restartError}
			onDismiss={onDismissUpdateError}
		/>
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
		<ConnectionInlineError
			updateError={slotErrors.updateError}
			restartError={slotErrors.restartError}
			onDismiss={onDismissUpdateError}
		/>
	</div>
{:else if slot === "channel-mismatch" && channelMismatch}
	<div
		class="mt-3 space-y-2 border-l-4 border-warning-500 bg-warning-500/15 px-3 py-2 text-xs"
		data-testid="connection-channel-mismatch"
	>
		<div class="flex flex-wrap items-center justify-between gap-2">
			<span>App is <strong>{channelMismatch.appChannel}</strong>; Local is <strong>{channelMismatch.serviceChannel}</strong>.</span>
			<button
				type="button"
				class={neutral}
				disabled={Boolean(channelControls?.disabled)}
				data-testid="connection-channel-mismatch-switch"
				on:click={() => onSwitchChannel(channelMismatch.appChannel)}
			>
				Switch Local to {channelMismatch.appChannel}
			</button>
		</div>
		<ConnectionInlineError
			updateError={slotErrors.updateError}
			restartError={slotErrors.restartError}
			onDismiss={onDismissUpdateError}
		/>
	</div>
{:else if slot === "stop-error"}
	<div class="mt-3 border-l-4 border-error-500 bg-error-500/15 px-3 py-2 text-xs text-error-700 dark:text-error-300" role="alert" data-testid="connection-context">
		{stopErrorText}
	</div>
{:else if slot === "install-error" || slot === "restart-error"}
	<ConnectionInlineError
		standalone
		updateError={slotErrors.updateError}
		restartError={slotErrors.restartError}
		onDismiss={onDismissUpdateError}
	/>
{:else if slot === "api-warning"}
	<div class="mt-3 space-y-2 border-l-4 border-warning-500 bg-warning-500/15 px-3 py-2 text-xs" data-testid="connection-api-warning">
		<p>{state.apiWarning}. Some features may not work.</p>
	</div>
{/if}
