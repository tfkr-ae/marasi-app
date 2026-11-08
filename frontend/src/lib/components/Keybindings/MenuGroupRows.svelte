<script>
	// The selected sidebar entry's menu groups, above its actions: the group's
	// tinted icon, label and description, then its menu letter as a chip (click
	// it to record another letter) and Reset in the same positions as an
	// action's Add binding and Reset. The global entry's groups are the ones
	// every Marasi menu shows in its Marasi section, so they are headed Marasi.
	import { RotateCcw } from "lucide-svelte";
	import { groupIcon, groupTone } from "../MarasiMenu/groupStyle.js";

	export let rows; // browse() menuItems
	export let heading; // "Menu groups", or "Marasi" for the global groups
	export let onRecord; // (groupId) => void
	export let onReset; // (groupId) => void

	const iconButton = "btn h-8 w-8 shrink-0 p-0 variant-soft-primary !border-0 !ring-0";
</script>

{#if rows.length}
	<section data-menu-groups>
		<h3 class="border-b border-surface-300 px-3 py-1.5 text-xs font-bold opacity-70 dark:border-surface-600">{heading}</h3>
		<ul>
			{#each rows as row (row.id)}
				<li
					class="flex items-center justify-between gap-4 border-b border-l-4 border-b-surface-300 px-3 py-1.5 dark:border-b-surface-600 {row.status ===
					'conflict'
						? 'border-l-error-500'
						: 'border-l-transparent'}"
					data-menu-group-id={row.id}
				>
					<div class="flex min-w-0 items-center gap-3">
						<span class="flex h-7 w-7 flex-none items-center justify-center {groupTone(row.group).tile}">
							<svelte:component this={groupIcon(row.group)} size="15" />
						</span>
						<div class="flex min-w-0 flex-col">
							<span>{row.group.label}</span>
							{#if row.group.description}
								<span class="text-xs opacity-70">{row.group.description}</span>
							{/if}
							{#if row.status === "conflict"}
								<span class="text-xs text-error-600 dark:text-error-400">{row.problem}</span>
							{/if}
						</div>
					</div>
					<div class="flex shrink-0 items-center justify-end gap-2">
						<span class="kbd inline-flex items-center rounded-none p-0 text-sm">
							<button
								type="button"
								class="px-2 py-0.5 hover:text-primary-500"
								title="Record a letter"
								aria-label="Record a letter for {row.group.label}"
								on:click={() => onRecord(row.id)}>{row.letter}</button
							>
						</span>
						<span class="h-8 w-8 shrink-0" aria-hidden="true"></span>
						<button
							type="button"
							class={iconButton}
							disabled={!row.resettable}
							title={row.resettable ? `Reset to ${row.factoryLetter}` : "Already the default"}
							aria-label="Reset {row.group.label}"
							on:click={() => onReset(row.id)}><RotateCcw size={16} /></button
						>
					</div>
				</li>
			{/each}
		</ul>
	</section>
{/if}
