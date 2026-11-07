<script>
	// The Marks menu's panel: one row per mark with its match count. Choosing
	// a row dispatches `toggle` with the mark's query term; a row whose term
	// is in the query is marked active.
	import { createEventDispatcher } from "svelte";
	import { BookCheckIcon, FlagIcon, PenIcon, SendIcon, ShieldAlertIcon } from "lucide-svelte";
	import { hasQueryTerm } from "../ledgerQueryFields.js";
	import { MARKS } from "./marks.js";
	import { matchCountText } from "./counts.js";

	/** The text in the query box. */
	export let queryText = "";
	/**
	 * { [term]: { count, capped, stale? } | null }; a missing term is still
	 * loading, a stale one shows dimmed until its recount arrives.
	 */
	export let counts = {};

	const dispatch = createEventDispatcher();
	const icons = { note: PenIcon, finding: ShieldAlertIcon, "test-case": BookCheckIcon, launchpad: SendIcon, intercepted: FlagIcon };
</script>

<div class="py-1 text-xs" role="menu">
	{#each MARKS as mark (mark.id)}
		{@const active = hasQueryTerm(queryText, mark.term)}
		<button
			type="button"
			class="ledger-mark flex w-full items-center gap-2 border-l-4 py-1 pl-2 pr-3 {active
				? 'border-primary-500 bg-primary-500/20'
				: 'border-transparent hover:bg-surface-200-700-token'}"
			role="menuitemcheckbox"
			aria-checked={active}
			data-term={mark.term}
			title={mark.term}
			on:click={() => dispatch("toggle", mark.term)}
		>
			<svelte:component this={icons[mark.id]} size={12} class="flex-none opacity-60" />
			<span class="flex-1 text-left">{mark.label}</span>
			<span class="ledger-mark-count min-w-[3rem] text-right tabular-nums {counts[mark.term]?.stale ? 'opacity-30' : 'opacity-60'}"
				>{matchCountText(counts[mark.term])}</span
			>
		</button>
	{/each}
</div>
