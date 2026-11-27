<script>
	// Collapsed setup disclosure for ConnectionDetail: service Update channel
	// and Reinstall on all supported non-dev connections, plus Local CLI path,
	// manual Carried CLI install, and When quitting Marasi App on desktop local
	// connections only.
	import { ChevronDown, ChevronRight } from "lucide-svelte";
	import { cliSourceLabel } from "./cli.js";
	import { LOCAL_QUIT_CHOICES, reinstallConfirmCopy, SERVICE_CHANNELS } from "./detail.js";

	export let connection;
	export let setup;
	export let channelControls;
	export let isDesktopLocal;
	export let localCLI;
	export let carriedRow;
	export let whenQuitting;
	export let connectionBusy;
	export let primary;
	export let neutral;
	export let primaryVar;
	export let row;
	export let onSwitchChannel;
	export let onReinstall;
	export let onChangeCLIPath;
	export let onClearCLIPath;
	export let onInstallCarried;
	export let onSetWhenQuitting;

	let open = false;
	let reinstallAsk = false;

	$: reinstallCopy = channelControls ? reinstallConfirmCopy(channelControls.channel, connection.name) : null;
	$: if (!channelControls) reinstallAsk = false;

	function chooseChannel(channel) {
		reinstallAsk = false;
		onSwitchChannel(channel);
	}

	function confirmReinstall() {
		reinstallAsk = false;
		onReinstall();
	}
</script>

<div class="mt-4" data-testid="connection-setup">
	<button
		type="button"
		class="flex w-full items-center justify-between gap-2 bg-surface-200/70 px-3 py-2 text-left text-xs font-semibold hover:bg-surface-200 dark:bg-surface-700/60 dark:hover:bg-surface-700"
		aria-expanded={open}
		data-testid="connection-setup-toggle"
		on:click={() => (open = !open)}
	>
		<span class="flex min-w-0 items-center gap-1.5">
			{#if open}<ChevronDown size={14} class="shrink-0" />{:else}<ChevronRight size={14} class="shrink-0" />{/if}
			<span class="truncate">{setup.title}</span>
		</span>
		{#if setup.summary}
			<span class="shrink-0 font-mono text-2xs font-normal opacity-65" data-testid="connection-setup-summary">{setup.summary}</span>
		{/if}
	</button>
	{#if open}
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
								on:click={() => chooseChannel(value)}
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
								<p class="text-xs opacity-70">Downloads from GitHub, even when older</p>
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
								on:click={onClearCLIPath}
							>
								Use PATH
							</button>
						{/if}
						<button
							type="button"
							class={neutral}
							disabled={localCLI.changingPath || localCLI.installing}
							data-testid="connection-cli-change"
							on:click={onChangeCLIPath}
						>
							Change
						</button>
					</div>
				</div>

				{#if carriedRow}
					<div class={row} data-testid="connection-cli-carried">
						<div class="min-w-0 flex-1">
							<p>Carried CLI</p>
							<p class="truncate font-mono text-2xs opacity-65" title={carriedRow.detail} data-testid="connection-cli-carried-version">
								{carriedRow.detail}
							</p>
						</div>
						<button
							type="button"
							class="{neutral} shrink-0"
							disabled={localCLI.installing || localCLI.changingPath || connectionBusy}
							data-testid="connection-cli-carried-install"
							on:click={onInstallCarried}
						>
							{localCLI.installing ? carriedRow.busyLabel : carriedRow.label}
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
								on:click={() => onSetWhenQuitting(value)}
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
