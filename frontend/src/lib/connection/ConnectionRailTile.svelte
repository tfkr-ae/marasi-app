<script>
	// The rail's connection tile, above the light switch: the active
	// connection's icon, name, health dot, and subtle primary update indicator
	// dot. It opens the Connections modal.
	import { getModalStore } from "@skeletonlabs/skeleton";
	import { Laptop, Server } from "lucide-svelte";
	import { connectionStore } from "../../stores/connectionStore.js";
	import { localCLIStore } from "../../stores/localCLIStore.js";
	import { serviceUpdateStore } from "../../stores/serviceUpdateStore.js";
	import { mobile } from "../platform.js";
	import { proactiveCarriedUpgrade } from "./carried.js";
	import { connectionTileIndicator } from "./indicators.js";
	import { connectionsModal } from "./modal.js";
	import { phaseLabel, phaseTone } from "./status.js";

	const modalStore = getModalStore();
	$: connection = $connectionStore.connection;
	$: phase = $connectionStore.phase;
	$: restarting = $connectionStore.restarting;
	$: tone = restarting ? "bg-warning-500" : phaseTone(phase);
	$: label = restarting ? "Restarting" : phaseLabel(phase);
	$: carriedUpgrade = proactiveCarriedUpgrade({
		mobile: $mobile,
		connectionState: $connectionStore,
		updateState: $serviceUpdateStore,
		carried: $localCLIStore.carried,
		cli: $localCLIStore.cli,
		dismissedVersion: $localCLIStore.dismissedVersion,
	});
	$: indicator = connectionTileIndicator($connectionStore, $serviceUpdateStore, { carriedUpgrade });
	$: tileTitle = indicator ? `${connection.name} · ${label} · ${indicator.label}` : `${connection.name} · ${label}`;
	function open() {
		if (!$modalStore.length) modalStore.trigger(connectionsModal());
	}
</script>

<button
	type="button"
	class="flex w-full flex-col items-center gap-1 py-2 text-2xs font-semibold leading-tight hover:bg-primary-500/10"
	title={tileTitle}
	data-testid="connection-tile"
	data-phase={phase}
	data-update-indicator={indicator?.kind ?? ""}
	on:click={open}
>
	<span class="relative">
		{#if connection.kind === "local"}<Laptop size={20} />{:else}<Server size={20} />{/if}
		<span
			class="absolute -right-1.5 -top-1 h-2.5 w-2.5 rounded-full ring-2 ring-surface-50 dark:ring-surface-800 {tone}"
			class:animate-pulse={phase === "reconnecting" || restarting}
		></span>
		{#if indicator}
			<span
				class="absolute -left-1.5 -top-1 h-2 w-2 rounded-full bg-primary-500 ring-2 ring-surface-50 dark:ring-surface-800"
				data-testid="connection-tile-update-dot"
				aria-hidden="true"
			></span>
		{/if}
	</span>
	<span class="rail-label max-w-[4.25rem] truncate">{connection.name}</span>
</button>
