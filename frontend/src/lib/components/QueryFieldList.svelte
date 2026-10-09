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
	<table class="w-full">
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
