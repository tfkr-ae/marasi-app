<script>
	// The update panel, two panes. The left pane lists the install's steps
	// (Details, Download, Verify, Install, Restart), stopping in red where a
	// failure stopped them, and the build facts: the running version, the
	// update's version and its Channel, which links to the Channel setting.
	// The right pane shows only the current step: the release notes (or a
	// nightly's compare link) with Dismiss and Install, the download with
	// Cancel, verifying and installing, then Restart now or Later. A failure
	// shows what failed, the release page and, where it could help, Try again.
	//
	// The panel exists only for an update: it closes when the update goes
	// away (a check that finds none, a Channel switch, Dismiss).
	import { getModalStore, getToastStore, modeCurrent, ProgressBar } from "@skeletonlabs/skeleton";
	import { AlertTriangle, Check, Download, ExternalLink, RotateCw, X } from "lucide-svelte";
	import { goto } from "$app/navigation";
	import { BrowserOpenURL } from "../wailsjs/runtime/runtime";
	import {
		cancelUpdateDownload,
		dismissUpdate,
		installUpdate,
		restartToUpdate,
		updateState,
	} from "../../stores/updateStore";
	import {
		cancellable,
		channelSettingPath,
		downloadedAmount,
		nightlyNotes,
		progressPercent,
		showsUpdateIndicator,
		updatePanelFailure,
		updatePanelSteps,
		UpdateStep,
	} from "../updates.js";
	import { neutralVariant, primaryVariant } from "../launchpad/format.js";
	import { toastError } from "../toasts";

	export let parent;

	const modalStore = getModalStore();
	const toastStore = getToastStore();

	// Without an update there is nothing to show.
	$: if (!showsUpdateIndicator($updateState) && $modalStore[0]?.component === "Update") {
		parent.onClose();
	}

	// The Channel setting lives in Settings → Updates.
	function openChannelSetting() {
		parent.onClose();
		goto(channelSettingPath);
	}

	// Dismissing leaves no update, which closes the panel.
	function dismiss() {
		dismissUpdate().catch((err) => toastError(toastStore, "Could not dismiss the update", err));
	}

	let restartError = "";

	function restart() {
		restartError = "";
		restartToUpdate().catch((err) => {
			restartError = String(err);
		});
	}

	$: update = $updateState.Update;
	$: running = $updateState.Running;
	$: progress = $updateState.Progress;
	// A nightly's notes list its commits; a release's are shown as published.
	$: nightly = update?.Channel === "nightly";
	$: notes = nightly ? nightlyNotes(update?.Notes) : (update?.Notes ?? "");
	$: panel = updatePanelSteps($updateState);
	$: failure = updatePanelFailure($updateState);
	// Buttons as elsewhere in the app: primary as in Launchpad and the
	// Ledger, the rest as Home's Open Project.
	$: primary = primaryVariant($modeCurrent);
	$: neutral = neutralVariant($modeCurrent);
</script>

{#if $modalStore[0] && update}
	<div
		class="card w-modal-wide shadow-xl bg-surface-50-800-token text-surface-900-50-token flex overflow-hidden"
		style="min-height: 24rem"
	>
		<aside class="w-72 shrink-0 border-r border-surface-300 dark:border-surface-600 p-4 flex flex-col">
			<h2 class="text-base font-bold">Update</h2>
			<ol class="mt-4" aria-label="Update steps">
				{#each panel.steps as step, i (step.id)}
					<li
						class="relative flex gap-3 pb-5 last:pb-0"
						aria-current={step.mark === "current" || step.mark === "failed" ? "step" : undefined}
					>
						{#if i < panel.steps.length - 1}
							<span
								class="absolute left-[0.5625rem] top-5 h-full w-px {step.mark === 'done'
									? 'bg-primary-500'
									: 'bg-surface-300 dark:bg-surface-600'}"
							></span>
						{/if}
						<span
							class="relative z-10 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-3xs font-bold
							{step.mark === 'failed'
								? 'bg-error-500 text-white'
								: step.mark === 'done'
									? 'bg-primary-500 text-white'
									: step.mark === 'current'
										? 'ring-2 ring-primary-500 bg-surface-50 dark:bg-surface-800'
										: 'bg-surface-300 dark:bg-surface-600'}"
						>
							{#if step.mark === "failed"}!{:else if step.mark === "done"}<Check size={12} />{/if}
						</span>
						<p
							class="text-sm leading-5 {step.mark === 'failed'
								? 'font-semibold text-error-600 dark:text-error-400'
								: step.mark === 'current'
									? 'font-semibold'
									: step.mark === 'done'
										? ''
										: 'opacity-60'}"
						>
							{step.label}
						</p>
					</li>
				{/each}
			</ol>
			<dl class="mt-auto grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 pt-6 text-xs">
				<dt class="opacity-60">Running</dt>
				<dd class="font-mono break-words">{running?.Version ?? "unknown"}</dd>
				<dt class="opacity-60">Update</dt>
				<dd class="font-mono break-words">{update.Version}</dd>
				<dt class="opacity-60">Channel</dt>
				<dd>
					<button
						type="button"
						class="anchor capitalize"
						title="Channel setting"
						on:click={openChannelSetting}>{update.Channel}</button
					>
				</dd>
			</dl>
		</aside>

		<section class="flex min-w-0 flex-1 flex-col p-4">
			<header class="flex items-center justify-between">
				<h3 class="text-sm font-bold">{failure ? "Failed" : panel.heading}</h3>
				<button
					type="button"
					class="btn-icon btn-icon-sm"
					aria-label="Close"
					on:click={parent.onClose}
				>
					<X size={16} />
				</button>
			</header>

			<div class="mt-3 flex-1 overflow-y-auto text-sm" aria-live="polite">
				{#if failure}
					<aside class="alert variant-soft-error" role="alert">
						<AlertTriangle size={18} />
						<p>{failure.message}. Your installed Marasi is unchanged.</p>
					</aside>
				{:else if panel.current === UpdateStep.details}
					{#if notes}
						<pre
							class="whitespace-pre-wrap break-words font-sans">{notes}</pre>
					{/if}
					{#if update.CompareURL}
						<button
							type="button"
							class="anchor inline-flex items-center gap-1"
							class:mt-3={notes}
							on:click={() => BrowserOpenURL(update.CompareURL)}
						>
							<span>Changes since your build</span>
							<ExternalLink size={14} />
						</button>
					{:else if !notes}
						<p class="opacity-60">No release notes.</p>
					{/if}
				{:else if panel.current === UpdateStep.download}
					<div class="flex h-full flex-col justify-center gap-3">
						<p class="text-xl font-bold font-mono">{progressPercent(progress) ?? 0}%</p>
						<ProgressBar
							value={progressPercent(progress) ?? undefined}
							max={100}
							height="h-2"
							meter="bg-primary-500"
						/>
						<p class="opacity-60 font-mono text-xs">{downloadedAmount(progress)}</p>
					</div>
				{:else if panel.current === UpdateStep.verify}
					<div class="flex h-full flex-col justify-center gap-3">
						<p>Checking the signature and checksum.</p>
						<ProgressBar height="h-2" meter="bg-primary-500" />
					</div>
				{:else if panel.current === UpdateStep.install}
					<div class="flex h-full flex-col justify-center gap-3">
						<p>Replacing Marasi.</p>
						<ProgressBar height="h-2" meter="bg-primary-500" />
					</div>
				{:else}
					<div class="flex h-full flex-col justify-center gap-1">
						<p class="font-mono text-lg break-words">{update.Version}</p>
						<p class="opacity-70">Installed. Runs on next launch.</p>
						{#if restartError}
							<p class="text-error-500">{restartError}</p>
						{/if}
					</div>
				{/if}
			</div>

			<footer class="mt-4 flex justify-end gap-2">
				{#if failure}
					<button type="button" class="btn btn-sm {neutral}" on:click={dismiss}>Dismiss</button>
					{#if update.ReleasePage}
						<button
							type="button"
							class="btn btn-sm {neutral}"
							on:click={() => BrowserOpenURL(update.ReleasePage)}
						>
							<ExternalLink size={14} />
							<span>Release page</span>
						</button>
					{/if}
					{#if failure.retry}
						<button type="button" class="btn btn-sm {primary}" on:click={installUpdate}>
							<Download size={14} />
							<span>Try again</span>
						</button>
					{/if}
				{:else if $updateState.Status === "downloading"}
					{#if cancellable(progress)}
						<button type="button" class="btn btn-sm {neutral}" on:click={cancelUpdateDownload}
							>Cancel</button
						>
					{/if}
				{:else if $updateState.Status === "restart-pending"}
					<button type="button" class="btn btn-sm {neutral}" on:click={parent.onClose}>Later</button>
					<button type="button" class="btn btn-sm {primary}" on:click={restart}>
						<RotateCw size={14} />
						<span>Restart now</span>
					</button>
				{:else}
					<button type="button" class="btn btn-sm {neutral}" on:click={dismiss}>Dismiss</button>
					<button type="button" class="btn btn-sm {primary}" on:click={installUpdate}>
						<Download size={14} />
						<span>Install</span>
					</button>
				{/if}
			</footer>
		</section>
	</div>
{/if}
