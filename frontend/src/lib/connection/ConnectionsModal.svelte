<script>
	// The Connections modal over the open page, from the rail's connection
	// tile: the connections and Add connection on the left, the picked one's
	// details (or the add form) on the right. Registered as "Connections"
	// (modal.js).
	import { getModalStore } from "@skeletonlabs/skeleton";
	import { Laptop, Plus, Server, X } from "lucide-svelte";
	import { connectionStore } from "../../stores/connectionStore.js";
	import AddConnection from "./AddConnection.svelte";
	import ConnectionDetail from "./ConnectionDetail.svelte";
	import { phaseTone, whereText } from "./status.js";

	const modalStore = getModalStore();
	$: connections = $connectionStore.connections;
	// A connection's id, or "add" for the add form.
	let picked = $connectionStore.connection.id;
	$: pickedConnection = connections.find((c) => c.id === picked) ?? connections[0];
	const row = (on) =>
		`flex w-full items-center gap-2 border-l-4 px-3 py-2 text-left hover:bg-surface-200 dark:hover:bg-surface-700 ${
			on ? "border-primary-500 bg-surface-200 dark:bg-surface-700" : "border-transparent"
		}`;
</script>

{#if $modalStore[0]}
	<div
		class="card w-[52rem] max-w-[95vw] rounded-none bg-surface-50-800-token text-sm shadow-xl text-surface-900-50-token"
		data-testid="connections-modal"
	>
		<header class="flex items-center justify-between border-b border-surface-300 px-4 py-3 dark:border-surface-600">
			<h2 class="text-base font-bold">Connections</h2>
			<button type="button" aria-label="Close" on:click={modalStore.close}><X size={16} /></button>
		</header>
		<div class="flex h-[30rem] min-h-0">
			<nav class="w-56 shrink-0 overflow-y-auto border-r border-surface-300 py-2 dark:border-surface-600" aria-label="Connections">
				{#each connections as c (c.id)}
					<button type="button" class={row(picked === c.id)} data-testid="connection-item" on:click={() => (picked = c.id)}>
						{#if c.kind === "local"}<Laptop size={14} class="shrink-0 opacity-70" />{:else}<Server size={14} class="shrink-0 opacity-70" />{/if}
						<span class="flex min-w-0 flex-1 flex-col">
							<span class="truncate">{c.name}</span>
							<span class="truncate text-xs opacity-70">{whereText(c, null)}</span>
						</span>
						{#if c.id === $connectionStore.connection.id}
							<span class="h-2 w-2 shrink-0 rounded-full {phaseTone($connectionStore.phase)}"></span>
						{/if}
					</button>
				{/each}
				<button type="button" class={row(picked === "add")} data-testid="add-connection-item" on:click={() => (picked = "add")}>
					<Plus size={14} class="shrink-0 opacity-70" /> Add connection
				</button>
			</nav>
			<section class="min-w-0 flex-1 overflow-y-auto px-5 py-4">
				{#if picked === "add"}
					<AddConnection on:added={(e) => (picked = e.detail)} />
				{:else}
					{#key pickedConnection.id}<ConnectionDetail connection={pickedConnection} />{/key}
				{/if}
			</section>
		</div>
	</div>
{/if}
