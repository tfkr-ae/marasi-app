<script>
	// Reusable inline error block for service update and restart failures.
	// Renders either embedded inside a higher-precedence contextual card
	// (restart-required, carried-upgrade, available, channel-mismatch) or as
	// a standalone contextual card (install-error, restart-error).
	import { ExternalLink } from "lucide-svelte";
	import { openURL } from "../runtime.js";

	export let updateError = null;
	export let restartError = null;
	export let standalone = false;
	export let onDismiss = () => {};
</script>

{#if updateError || restartError}
	<div
		class={standalone
			? "mt-3 space-y-1.5 border-l-4 border-error-500 bg-error-500/15 px-3 py-2.5 text-xs text-error-700 dark:text-error-300"
			: "space-y-1.5 border-t border-surface-300 pt-2 text-error-700 dark:border-surface-600 dark:text-error-300"}
	>
		{#if updateError}
			<div class="space-y-1" role="alert" data-testid="connection-update-error">
				<div class="flex flex-wrap items-start justify-between gap-2">
					<p class="min-w-0 flex-1 break-words font-semibold">{updateError.message}</p>
					<div class="flex shrink-0 items-center gap-3">
						{#if updateError.page}
							<button
								type="button"
								class="inline-flex items-center gap-1 underline opacity-85 hover:opacity-100"
								data-testid="connection-update-error-page"
								on:click={() => openURL(updateError.page)}
							>
								<span>Release page</span><ExternalLink size={11} />
							</button>
						{/if}
						<button
							type="button"
							class="underline opacity-75 hover:opacity-100"
							data-testid="connection-update-error-dismiss"
							on:click={onDismiss}
						>
							Dismiss
						</button>
					</div>
				</div>
				{#if updateError.installPath}
					<p class="break-all font-mono text-2xs opacity-85" data-testid="connection-update-error-path">
						Install path: {updateError.installPath}
					</p>
				{/if}
			</div>
		{/if}
		{#if restartError}
			<p class="min-w-0 break-words" role="alert" data-testid="connection-restart-error">
				{restartError}
			</p>
		{/if}
	</div>
{/if}
