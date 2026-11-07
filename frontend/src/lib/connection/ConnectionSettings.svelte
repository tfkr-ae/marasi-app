<script>
	// Settings → Connection: the Connections modal's list and details, laid
	// out as a Settings section. Add connection comes with ticket 14.
	import { Laptop, Server } from "lucide-svelte";
	import { connectionStore } from "../../stores/connectionStore.js";
	import ConnectionDetail from "./ConnectionDetail.svelte";
	import { phaseLabel, phaseTone, whereText } from "./status.js";

	$: connections = [$connectionStore.connection];
	let picked = $connectionStore.connection.id;
	$: pickedConnection = connections.find((c) => c.id === picked) ?? connections[0];
	$: activeId = $connectionStore.connection.id;
</script>

<h3 class="text-sm font-bold">Connection</h3>
<p class="text-xs opacity-70">Where Marasi runs.</p>

<div class="mt-3 border-y border-surface-300 dark:border-surface-600">
	{#each connections as c (c.id)}
		<button
			type="button"
			class="flex w-full items-center gap-3 border-b border-surface-200 px-2 py-2 text-left last:border-b-0 hover:bg-primary-500/10 dark:border-surface-700 {picked ===
			c.id
				? '!bg-primary-500/20'
				: ''}"
			on:click={() => (picked = c.id)}
		>
			{#if c.kind === "local"}<Laptop size={14} class="opacity-70" />{:else}<Server size={14} class="opacity-70" />{/if}
			<span class="w-40 truncate">{c.name}</span>
			<span class="flex-1 truncate font-mono text-2xs opacity-60">{whereText(c, c.id === activeId ? $connectionStore.instance : null)}</span>
			{#if c.id === activeId}
				<span class="flex items-center gap-1.5 text-xs">
					<span class="h-2 w-2 rounded-full {phaseTone($connectionStore.phase)}"></span>{phaseLabel($connectionStore.phase)}
				</span>
			{/if}
		</button>
	{/each}
</div>

<div class="mt-4 max-w-3xl">
	{#key pickedConnection.id}<ConnectionDetail connection={pickedConnection} rows />{/key}
</div>
