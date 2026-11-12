<script>
	// The rail's connection tile, above the light switch: the active
	// connection's icon, name and status dot. It opens the Connections modal.
	import { getModalStore } from "@skeletonlabs/skeleton";
	import { Laptop, Server } from "lucide-svelte";
	import { connectionStore } from "../../stores/connectionStore.js";
	import { connectionsModal } from "./modal.js";
	import { phaseLabel, phaseTone } from "./status.js";

	const modalStore = getModalStore();
	$: connection = $connectionStore.connection;
	$: phase = $connectionStore.phase;
	function open() {
		if (!$modalStore.length) modalStore.trigger(connectionsModal());
	}
</script>

<button
	type="button"
	class="flex w-full flex-col items-center gap-1 py-2 text-2xs font-semibold leading-tight hover:bg-primary-500/10"
	title="{connection.name} · {phaseLabel(phase)}"
	data-testid="connection-tile"
	data-phase={phase}
	on:click={open}
>
	<span class="relative">
		{#if connection.kind === "local"}<Laptop size={20} />{:else}<Server size={20} />{/if}
		<span
			class="absolute -right-1.5 -top-1 h-2.5 w-2.5 rounded-full ring-2 ring-surface-50 dark:ring-surface-800 {phaseTone(phase)}"
			class:animate-pulse={phase === "reconnecting"}
		></span>
	</span>
	<span class="rail-label max-w-[4.25rem] truncate">{connection.name}</span>
</button>
