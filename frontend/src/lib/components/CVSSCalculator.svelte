<script>
	// The CVSS 3.1 calculator: a score row over the eight base metrics.
	// The logic is in lib/cvss.js; callers bind the vector and score, and
	// set the severity from on:change (or severityFromScore) as they need.
	import { createEventDispatcher, onDestroy } from "svelte";
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import { ChevronDown, ChevronRight, ClipboardPaste, Copy, X } from "lucide-svelte";
	import { primaryVariant } from "../launchpad/format.js";
	import { interceptModalEscape } from "../overlayIsolation.js";
	import { SEVERITY_BADGE } from "../logbook/severityColors.js";
	import { CVSS_DEFAULTS, CVSS_GROUPS, parseCvss, pasteCvss, pickCvss, severityFromScore } from "../cvss.js";

	/** The CVSS 3.1 vector, or "" when unscored. */
	export let vector = "";
	/** The base score the vector gives, or null. Set here; bind to read it. */
	export let score = null;
	/** Whether the metrics show under the score row. */
	export let open = true;
	/** One group above the other, for a narrow host such as the modal form. */
	export let stacked = false;

	const dispatch = createEventDispatcher();

	let pasting = false;
	let pasted = "";
	let pasteError = "";
	let pasteInput;

	// In a modal, Escape closes the paste box, not the modal.
	let releaseEscape = null;
	$: if (pasting && !releaseEscape) releaseEscape = interceptModalEscape(() => (pasting = false));
	$: if (!pasting && releaseEscape) {
		releaseEscape();
		releaseEscape = null;
	}
	onDestroy(() => releaseEscape?.());

	$: primary = primaryVariant($modeCurrent);
	$: parsed = parseCvss(vector);
	$: score = parsed.score;
	$: selections = parsed.selections;
	$: scored = !!vector && score !== null;
	$: severity = scored ? severityFromScore(score) : null;

	function set(next) {
		vector = next;
		const nextScore = parseCvss(next).score;
		dispatch("change", {
			vector: next,
			score: nextScore,
			severity: next ? severityFromScore(nextScore) : null,
		});
	}

	function openPaste() {
		pasting = !pasting;
		pasted = "";
		pasteError = "";
		if (pasting) setTimeout(() => pasteInput?.focus());
	}

	function applyPaste() {
		const result = pasteCvss(pasted);
		if (result.error) {
			pasteError = result.error;
			pasteInput?.focus();
			return;
		}
		set(result.vector);
		pasting = false;
		pasted = "";
		pasteError = "";
	}

	const iconButton = "btn-icon btn-icon-sm h-6 w-6 flex-none rounded-none opacity-60 hover:opacity-100 hover:bg-surface-500/15";
</script>

<div class="border border-surface-500/30 bg-white dark:bg-surface-800" data-testid="cvss-calculator">
	<div class="flex items-center gap-1 pr-1">
		<button
			type="button"
			class="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
			title={open ? "Hide metrics" : "Show metrics"}
			aria-expanded={open}
			on:click={() => (open = !open)}
		>
			<span class="flex-none opacity-60">
				{#if open}<ChevronDown size={13} />{:else}<ChevronRight size={13} />{/if}
			</span>
			{#if scored}
				<span class="flex-none text-base font-bold leading-none tabular-nums">{score.toFixed(1)}</span>
				<span class="badge flex-none rounded-sm px-1.5 py-0.5 text-[10px] font-bold {SEVERITY_BADGE[severity] ?? 'variant-soft'}"
					>{severity}</span
				>
				<code class="min-w-0 flex-1 truncate bg-transparent p-0 font-mono text-[11px] opacity-80">{vector.replace("CVSS:3.1/", "")}</code>
			{:else if vector}
				<span class="badge flex-none variant-filled-error rounded-sm px-1.5 py-0.5 text-[10px] font-bold">Invalid</span>
				<code class="min-w-0 flex-1 truncate bg-transparent p-0 font-mono text-[11px] opacity-80">{vector}</code>
			{:else}
				<span class="min-w-0 flex-1 truncate text-xs opacity-60">Not scored</span>
			{/if}
		</button>
		{#if vector}
			<button type="button" class={iconButton} title="Copy vector" on:click={() => navigator.clipboard?.writeText(vector)}>
				<Copy size={12} />
			</button>
		{/if}
		<button type="button" class={iconButton} title="Paste vector" aria-pressed={pasting} on:click={openPaste}>
			<ClipboardPaste size={12} />
		</button>
		{#if vector}
			<button type="button" class={iconButton} title="Clear score" on:click={() => set("")}>
				<X size={12} />
			</button>
		{/if}
	</div>

	{#if pasting}
		<form class="flex items-center gap-1 border-t border-surface-500/30 px-2 py-1.5" on:submit|preventDefault={applyPaste}>
			<input
				bind:this={pasteInput}
				class="input h-7 min-w-0 flex-1 rounded-none border-0 bg-surface-100 py-0 font-mono text-[11px] ring-0 focus:ring-0 dark:bg-surface-700"
				placeholder="CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"
				spellcheck="false"
				bind:value={pasted}
				on:input={() => (pasteError = "")}
				on:keydown={(e) => {
					if (e.key === "Escape") {
						e.stopPropagation();
						pasting = false;
					}
				}}
			/>
			<button type="submit" class="btn btn-sm {primary} rounded-none py-0.5">Apply</button>
		</form>
		{#if pasteError}
			<p class="px-2 pb-1.5 text-[11px] text-error-500">{pasteError}</p>
		{/if}
	{/if}

	{#if open}
		<div class="grid gap-x-4 gap-y-3 border-t border-surface-500/30 p-2 {stacked ? '' : 'md:grid-cols-2'}">
			{#each CVSS_GROUPS as group}
				<div class="space-y-1">
					<div class="text-[10px] font-bold uppercase tracking-wider opacity-50">{group.name}</div>
					{#each group.metrics as m}
						<div class="flex items-center gap-2">
							<span class="w-28 flex-none truncate text-[11px] opacity-80" title="{m.name} ({m.key})">{m.name}</span>
							<div class="flex min-w-0 flex-1 gap-px" role="group" aria-label={m.name}>
								{#each m.options as [value, label]}
									{@const chosen = !!vector && selections[m.key] === value}
									{@const preset = !vector && CVSS_DEFAULTS[m.key] === value}
									<button
										type="button"
										class="min-w-0 flex-1 truncate rounded-none px-1 py-1 text-[11px] transition-colors {chosen
											? primary
											: preset
												? 'bg-primary-500/10 hover:bg-primary-500/20 dark:bg-primary-500/20 dark:hover:bg-primary-500/30'
												: 'bg-surface-100 hover:bg-surface-200 dark:bg-surface-700 dark:hover:bg-surface-600'}"
										title="{m.name}: {label} ({m.key}:{value})"
										aria-pressed={chosen}
										on:click={() => set(pickCvss(vector, m.key, value))}>{label}</button
									>
								{/each}
							</div>
						</div>
					{/each}
				</div>
			{/each}
		</div>
	{/if}
</div>
