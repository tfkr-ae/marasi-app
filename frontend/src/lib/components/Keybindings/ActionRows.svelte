<script>
	// The selected sidebar entry's actions, styled like Marasi menu entries:
	// label, description, then the row's status (the conflict, Unbound, the
	// allowed shadowing of a global binding, or why an extension action is
	// unavailable). Unavailable rows show their kept bindings but cannot be
	// edited until the extension returns.
	import BindingChips from "./BindingChips.svelte";

	export let rows; // browse() rows
	export let onRecord; // (actionId, index?) => void
	export let onRemove; // (actionId, index) => void
	export let onReset; // (actionId) => void

	const bar = {
		conflict: "border-l-error-500",
		unbound: "border-l-warning-500",
		unavailable: "border-l-surface-400 dark:border-l-surface-500",
	};
</script>

<ul>
	{#each rows as row (row.action.id)}
		<li
			class="flex items-center justify-between gap-4 border-b border-l-4 border-b-surface-300 px-3 py-2 dark:border-b-surface-600 {bar[row.status] ?? 'border-l-transparent'}"
			data-action-id={row.action.id}
			data-unavailable={row.available === false ? "" : undefined}
		>
			<div class="flex min-w-0 flex-col {row.available === false ? 'opacity-70' : ''}">
				<span>{row.action.label}</span>
				{#if row.action.description}
					<span class="text-sm opacity-70">{row.action.description}</span>
				{/if}
				{#if row.status === "conflict"}
					<span class="text-sm text-error-600 dark:text-error-400">{row.problem}</span>
				{:else if row.status === "unbound"}
					<span class="text-sm text-warning-800 dark:text-warning-500">Unbound</span>
				{:else if row.status === "shadowing"}
					<!-- Allowed: the more specific context wins there. Not an error. -->
					<span class="text-sm opacity-70" data-shadowing>{row.problem}</span>
				{:else if row.status === "unavailable"}
					<span class="text-sm italic">{row.note}</span>
				{/if}
			</div>
			<BindingChips
				{row}
				disabled={row.available === false}
				onRecord={(index) => onRecord(row.action.id, index)}
				onRemove={(index) => onRemove(row.action.id, index)}
				onReset={() => onReset(row.action.id)}
			/>
		</li>
	{:else}
		<li class="p-4 text-sm opacity-60">No actions match.</li>
	{/each}
</ul>
