<script>
	// The opening screen: what opening a project is doing, step by step, and
	// the way forward when it can't. It renders only what lib/openProgress.js
	// returns for the open; the layout shows it over the app and handles the
	// choices: `stay`, `retry`, `open` (detail: the picked project's path)
	// and `browse`.
	import { createEventDispatcher } from "svelte";
	import { modeCurrent, ProgressBar } from "@skeletonlabs/skeleton";
	import {
		Check,
		ChevronDown,
		ChevronRight,
		FolderInput,
		FolderOpen,
		Lock,
		RotateCw,
	} from "lucide-svelte";
	import Logo from "./Logo.svelte";
	import { openingScreen } from "../openProgress.js";

	/** The open in progress (openProgress.js state). */
	export let state;

	const dispatch = createEventDispatcher();
	$: screen = openingScreen(state);
	let showLog = false;

	// The most recent remaining project is picked until the researcher
	// picks another.
	let picked = null;
	$: if (!screen.choices.some((choice) => choice.path === picked)) {
		picked = screen.choices[0]?.path ?? null;
	}
	$: pickedName = screen.choices.find((choice) => choice.path === picked)?.name;

	// The Modal's neutral and positive buttons, square.
	$: neutral =
		"btn btn-sm rounded-none " +
		($modeCurrent ? "variant-ghost-surface border-0 ring-0" : "variant-ghost-surface");
	$: positive =
		"btn btn-sm rounded-none " +
		($modeCurrent ? "variant-ghost-primary border-0 ring-0" : "variant-filled-primary");

	const bar = {
		height: "h-2",
		rounded: "rounded-none",
		meter: "bg-primary-500",
		track: "bg-surface-200 dark:bg-surface-700",
	};
</script>

<div class="flex min-h-full w-full items-center justify-center py-8">
	<div class="w-[27.5rem]">
		<header class="flex items-center gap-3">
			<Logo size="36" mode={$modeCurrent ? "light" : "dark"} />
			<div class="min-w-0">
				<h1 class="flex items-center gap-1.5 text-base font-bold">
					{#if screen.failure?.kind === "locked"}
						<Lock size={14} class="text-error-600 dark:text-error-400" aria-label="Locked" />
					{/if}
					{screen.project.name}
				</h1>
				{#if screen.project.path}
					<p class="truncate font-mono text-2xs opacity-60" title={screen.project.path}>
						{screen.project.path}
					</p>
				{/if}
			</div>
		</header>

		<ol class="mt-5 flex items-center" aria-label="Open steps">
			{#each screen.steps as step, i (step.id)}
				<li
					class="relative flex shrink-0 items-center gap-2"
					aria-current={step.mark === "current" || step.mark === "failed" ? "step" : undefined}
				>
					<span
						class="relative z-10 flex h-5 w-5 shrink-0 items-center justify-center text-3xs font-bold
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
					<span
						class="text-sm leading-5 {step.mark === 'failed'
							? 'font-semibold text-error-600 dark:text-error-400'
							: step.mark === 'current'
								? 'font-semibold'
								: step.mark === 'todo'
									? 'opacity-60'
									: ''}"
					>
						{step.label}
					</span>
				</li>
				{#if i < screen.steps.length - 1}
					<li
						aria-hidden="true"
						class="mx-3 h-px flex-1 {step.mark === 'done'
							? 'bg-primary-500'
							: 'bg-surface-300 dark:bg-surface-600'}"
					/>
				{/if}
			{/each}
		</ol>

		<div class="mt-5 min-h-16 text-sm">
			<p>{screen.sentence}</p>
			{#if screen.upgrade}
				<div class="mt-3"><ProgressBar {...bar} /></div>
				<p class="mt-1 font-mono text-xs opacity-60">
					{screen.upgrade.file} · {screen.upgrade.applied} applied
				</p>
			{:else if screen.load.part}
				<div class="mt-3">
					<ProgressBar {...bar} value={screen.load.done} max={screen.load.total} />
				</div>
			{:else if screen.failure}
				<p class="mt-4 text-xs opacity-60">{screen.choicesLabel}</p>
				<!-- The list scrolls so the buttons and Details stay on screen. -->
				<div class="mt-1 border-y border-surface-300 dark:border-surface-600">
					<ul class="max-h-48 overflow-y-auto">
						{#each screen.choices as choice (choice.path)}
							<li>
								<button
									class="flex w-full items-baseline gap-3 px-2 py-1.5 text-left text-sm hover:bg-primary-500/10 {picked ===
									choice.path
										? '!bg-primary-500/20'
										: ''}"
									title={choice.path}
									aria-pressed={picked === choice.path}
									on:click={() => (picked = choice.path)}
								>
									<span class="font-medium">{choice.name}</span>
									<span class="ml-auto text-xs opacity-60">{choice.opened}</span>
								</button>
							</li>
						{/each}
					</ul>
					<button
						class="flex w-full items-center gap-2 border-t border-surface-200 px-2 py-1.5 text-left text-sm opacity-80 hover:bg-primary-500/10 dark:border-surface-700"
						on:click={() => dispatch("browse")}
					>
						<FolderOpen size={14} /> Browse…
					</button>
				</div>
			{:else if screen.load.done < screen.load.total}
				<div class="mt-3"><ProgressBar {...bar} /></div>
			{/if}
		</div>

		{#if screen.actions}
			<footer class="mt-4 flex justify-end gap-2">
				{#if screen.actions.stayIn}
					<button class={neutral} on:click={() => dispatch("stay")}>
						Stay in {screen.actions.stayIn}
					</button>
				{/if}
				{#if screen.actions.tryAgain}
					<button class={neutral} on:click={() => dispatch("retry")}>
						<RotateCw size={14} /><span>Try again</span>
					</button>
				{/if}
				<!-- With no recent project left to pick, Open stays, disabled. -->
				<button class={positive} disabled={!picked} on:click={() => dispatch("open", picked)}>
					<FolderInput size={14} /><span>{picked ? `Open ${pickedName}` : "Open"}</span>
				</button>
			</footer>
		{/if}

		<button
			class="mt-6 flex items-center gap-1 text-xs opacity-60 hover:opacity-100"
			aria-expanded={showLog}
			on:click={() => (showLog = !showLog)}
		>
			{#if showLog}<ChevronDown size={12} />{:else}<ChevronRight size={12} />{/if}
			Details
		</button>
		{#if showLog}
			<pre
				class="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all bg-surface-100 p-2 font-mono text-2xs leading-5 dark:bg-surface-800">{screen.log.join("\n")}</pre>
		{/if}
	</div>
</div>
