<script>
	// Settings → Updates, its Marasi CLI part (the page draws the heading,
	// id "cli"): where the CLI is, where it came from, its version, Check for
	// CLI update, the CLI this build carries when it is another version (to
	// install instead of the channel's latest), and its channel (follow the
	// app, Release or Nightly). Go: cli_locate.go, cli_install.go and
	// cli_carried.go.
	import { getToastStore, modeCurrent } from "@skeletonlabs/skeleton";
	import { RefreshCw } from "lucide-svelte";
	import { onMount } from "svelte";
	import {
		BrowseCLIPath,
		CarriedCLI,
		CheckForCLIUpdate,
		ClearCLIPath,
		GetCLIChannel,
		InstallCarriedCLI,
		LocateCLI,
		RestartLocalInstance,
		SetCLIChannel,
		UseCLIPath,
	} from "../bindings/github.com/tfkr-ae/marasi-app/app.js";
	import { neutralButton, primaryButton } from "../launchpad/format.js";
	import { on } from "../runtime.js";
	import {
		CLI_UPDATE_CHECKED_EVENT,
		cliResultText,
		cliSourceLabel,
		installThenRestart,
		offersCarriedCLI,
		restartsAfterCLIInstall,
	} from "./cli.js";
	import CLISetup from "./CLISetup.svelte";
	import CLIProgress from "./CLIProgress.svelte";
	import { serviceUpdateLine, serviceUpdateStore } from "../../stores/serviceUpdateStore.js";
	import { connectionStore } from "../../stores/connectionStore.js";

	const toastStore = getToastStore();
	let cli = null;
	let channel = null;
	let checking = false;
	// The check found a newer CLI and is installing it (its first progress).
	let installingUpdate = false;
	let changing = false;
	// The CLI this build carries (CarriedCLI), Install running, and its
	// confirm for a local instance another program started.
	let carried = null;
	let installingCarried = false;
	let confirmingCarried = false;
	// The update check Go runs after placing the carried CLI is installing
	// a newer one (its progress, while Check isn't running).
	let updatingInBackground = false;

	// The connected service updating its own binary (update.* events).
	$: serviceUpdate = serviceUpdateLine($serviceUpdateStore);
	$: primary = primaryButton($modeCurrent);
	$: neutral = neutralButton($modeCurrent);
	$: busy = checking || installingCarried;
	// Install from embedded restarts the active local instance with the CLI
	// it installs, asking first when another program started it.
	$: restarts = restartsAfterCLIInstall($connectionStore);
	const row = "settings-row flex items-center justify-between gap-8 py-3 border-b border-surface-300 dark:border-surface-600";
	const control = "settings-control flex w-80 shrink-0";
	const channels = [
		["app", "Follow app"],
		["release", "Release"],
		["nightly", "Nightly"],
	];

	const toast = (message) => toastStore.trigger({ message });
	const failure = (err) => toast(String(err?.message ?? err));

	onMount(() => {
		LocateCLI().then((info) => (cli = info)).catch(failure);
		GetCLIChannel().then((c) => (channel = c)).catch(failure);
		CarriedCLI().then((c) => (carried = c)).catch(failure);
		// The layout toasts the result; this shows the CLI it left.
		const stopProgress = on("cli-install-progress", () => {
			if (!busy && cli?.found) updatingInBackground = true;
		});
		const stopChecked = on(CLI_UPDATE_CHECKED_EVENT, (result) => {
			updatingInBackground = false;
			if (result?.cli) cli = result.cli;
		});
		return () => {
			stopProgress();
			stopChecked();
		};
	});

	function chooseChannel(setting) {
		SetCLIChannel(setting).then((c) => (channel = c)).catch(failure);
	}

	function check() {
		checking = true;
		installingUpdate = false;
		const stop = on("cli-install-progress", () => {
			installingUpdate = true;
			stop();
		});
		CheckForCLIUpdate()
			.then((result) => {
				cli = result.cli;
				toast(cliResultText(result));
			})
			.catch(failure)
			.finally(() => {
				stop();
				checking = false;
				installingUpdate = false;
			});
	}

	function startInstallCarried() {
		if (restarts && !$connectionStore.owned) confirmingCarried = true;
		else installCarried();
	}

	function installCarried() {
		installingCarried = true;
		const restart = restarts ? () => RestartLocalInstance($connectionStore.connection.id) : null;
		const install = () =>
			InstallCarriedCLI().then((result) => {
				if (result.cli?.found) cli = result.cli;
				return result;
			});
		installThenRestart({ install, restart })
			.then((outcome) => {
				toast(outcome.text);
				if (outcome.ok && restart) connectionStore.retryNow();
			})
			.catch(failure)
			.finally(() => {
				installingCarried = false;
				confirmingCarried = false;
			});
	}

	function change() {
		changing = true;
		BrowseCLIPath()
			.then((path) => path && UseCLIPath(path).then((info) => (cli = info)))
			.catch(failure)
			.finally(() => (changing = false));
	}

	function reset() {
		ClearCLIPath().then((info) => (cli = info)).catch(failure);
	}
</script>

<p class="text-xs opacity-70">Runs the local Marasi service.</p>

{#if cli && !cli.found}
	<div class="max-w-xl"><CLISetup on:found={(event) => (cli = event.detail)} /></div>
{:else if cli}
	<div class={row}>
		<p>Location</p>
		<div class="{control} items-center justify-end gap-2">
			<p class="min-w-0 truncate font-mono text-xs" title={cli.path} data-testid="cli-location">{cli.path}</p>
			<button type="button" class={neutral} disabled={changing || busy} on:click={change}>Change</button>
		</div>
	</div>
	<div class={row}>
		<p>Source</p>
		<div class="{control} items-center justify-end gap-2">
			<p class="text-sm" data-testid="cli-source">{cliSourceLabel(cli.source)}</p>
			{#if cli.source === "custom"}
				<button type="button" class={neutral} disabled={busy} on:click={reset}>Use PATH</button>
			{/if}
		</div>
	</div>
	{#if cli.problem}
		<p class="bg-warning-500/15 px-2 py-1 text-xs break-words">{cli.problem}</p>
	{/if}
	<div class={row}>
		<p>Version</p>
		<div class="{control} items-center justify-end gap-2">
			<p class="whitespace-nowrap font-mono text-xs" data-testid="cli-version">{cli.version}</p>
			<button type="button" class={neutral} disabled={busy} on:click={check} data-testid="cli-check"
				><RefreshCw size={14} class={checking ? "animate-spin" : ""} /><span>Check for CLI update</span></button
			>
		</div>
	</div>
	{#if (checking && installingUpdate) || updatingInBackground}
		<div class="py-3"><CLIProgress /></div>
	{/if}
	{#if offersCarriedCLI(carried, cli)}
		<div class={row} data-testid="cli-carried">
			<div>
				<p>Embedded</p>
				<p class="text-xs opacity-70">The CLI this app carries</p>
			</div>
			<div class="{control} items-center justify-end gap-2">
				<p class="whitespace-nowrap font-mono text-xs" data-testid="cli-carried-version">{carried.version}</p>
				{#if confirmingCarried}
					<button type="button" class={neutral} disabled={busy} on:click={() => (confirmingCarried = false)}>Cancel</button>
					<button type="button" class={primary} disabled={busy} on:click={installCarried} data-testid="cli-install-carried-restart"
						>{installingCarried ? "Installing…" : "Install and restart"}</button
					>
				{:else}
					<button type="button" class={neutral} disabled={busy} on:click={startInstallCarried} data-testid="cli-install-carried"
						>{installingCarried ? "Installing…" : "Install from embedded"}</button
					>
				{/if}
			</div>
		</div>
		{#if confirmingCarried}
			<p class="py-1 text-right text-xs opacity-70" data-testid="cli-install-carried-confirm">
				Another program started Marasi. Its project reopens in the new instance.
			</p>
		{/if}
	{/if}
{/if}
{#if serviceUpdate}
	<div class={row} data-testid="service-update">
		<div>
			<p>Service update</p>
			<p class="text-xs opacity-70">The Marasi that {$connectionStore.connection.name} runs</p>
		</div>
		<div class="{control} justify-end">
			<p class="text-right text-xs break-words" data-testid="service-update-line">{serviceUpdate}</p>
		</div>
	</div>
{/if}
{#if channel}
	<div class={row}>
		<div>
			<p>Channel</p>
			<p class="text-xs opacity-70">Installs and updates use {channel.effective}</p>
		</div>
		<div class="{control} text-sm" role="radiogroup" aria-label="CLI channel">
			{#each channels as [value, label]}
				<button
					type="button"
					role="radio"
					aria-checked={channel.setting === value}
					class="flex-1 px-3 py-1 {channel.setting === value
						? primary
						: 'bg-surface-200 hover:bg-surface-300 dark:bg-surface-700 dark:hover:bg-surface-600'}"
					disabled={busy}
					on:click={() => chooseChannel(value)}>{label}</button
				>
			{/each}
		</div>
	</div>
{/if}
