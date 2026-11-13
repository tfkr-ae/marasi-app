<script>
	// The ledger query's field list: every field with its operators, an
	// example and one line of help. Clicking an example dispatches `insert`
	// with the example text.
	import { createEventDispatcher } from "svelte";
	import { QUERY_FIELDS, QUERY_PREAMBLE } from "../ledgerQueryFields";

	const dispatch = createEventDispatcher();
</script>

<div class="space-y-2 text-xs">
	<p class="opacity-80">{QUERY_PREAMBLE}</p>
	<table class="query-fields w-full">
		<tbody>
			{#each QUERY_FIELDS as field}
				<tr class="border-t border-surface-500/20 align-top">
					<td class="whitespace-nowrap py-1 pr-2 font-mono font-bold"
						>{field.name}</td
					>
					<td class="whitespace-nowrap py-1 pr-2 font-mono opacity-70"
						>{field.ops.join(" ")}</td
					>
					<td class="py-1">
						<button
							type="button"
							class="break-all text-left font-mono text-primary-500 hover:underline"
							title="Insert into the query"
							on:click={() => dispatch("insert", field.example)}
							>{field.example}</button
						>
						<div class="opacity-60">{field.help}</div>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	/* The mobile layout (html.mobile, lib/platform.js). The selectors are
	   global, as app.css's shared mobile rules are, so they weigh the same
	   against Skeleton's and Tailwind's classes. */
	/* ---- Narrow mobile toolbars (the Ledger's and the Logbook's) ----
	   The Ledger's search takes its own row, so the query box has room to tap
	   and type in, and the menus share the row under it, equal widths. A
	   toolbar menu's panel spans the toolbar, under it, instead of hanging
	   off its button past the screen's edge; so does the query fields list,
	   whose field, operators and example stack. */
	@media (max-width: 40rem) {
		:global(html.mobile .query-fields tr) {
			display: grid;
			grid-template-columns: auto minmax(0, 1fr);
			column-gap: 0.5rem;
			padding: 0.25rem 0;
		}
		:global(html.mobile .query-fields td) {
			padding: 0;
		}
		:global(html.mobile .query-fields td:nth-child(3)) {
			grid-column: 1 / -1;
		}
	}
</style>
