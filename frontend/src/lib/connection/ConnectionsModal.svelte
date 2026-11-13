<script>
	// The Connections modal over the open page, from the rail's connection
	// tile: the connections and Add connection on the left, the picked one's
	// details (or the add form) on the right. Registered as "Connections"
	// (modal.js). The iOS app can't run the Marasi CLI: it lists only remotes,
	// adding is pairing (a QR code, or by hand), a new remote is switched to
	// at once, and with none saved the modal is only the pairing view
	// (pairing-view.js).
	import { getModalStore } from "@skeletonlabs/skeleton";
	import { Laptop, Plus, Server, X } from "lucide-svelte";
	import { connectionStore } from "../../stores/connectionStore.js";
	import { mobile } from "../platform.js";
	import AddConnection from "./AddConnection.svelte";
	import ConnectionDetail from "./ConnectionDetail.svelte";
	import PairConnection from "./PairConnection.svelte";
	import { connectionsView } from "./pairing-view.js";
	import { phaseTone, whereText } from "./status.js";

	const modalStore = getModalStore();
	// A connection's id, or "add" for the add form.
	let picked = $connectionStore.connection.id;
	$: view = connectionsView({ mobile: $mobile, connections: $connectionStore.connections, picked });

	function added(id) {
		picked = id;
		if ($mobile) connectionStore.switchTo(id);
	}
	const row = (on) =>
		`flex w-full items-center gap-2 border-l-4 px-3 py-2 text-left hover:bg-surface-200 dark:hover:bg-surface-700 ${
			on ? "border-primary-500 bg-surface-200 dark:bg-surface-700" : "border-transparent"
		}`;
</script>

{#if $modalStore[0]}
	<div
		class="connections-modal card w-[52rem] max-w-full rounded-none bg-surface-50-800-token text-sm shadow-xl text-surface-900-50-token"
		data-testid="connections-modal"
	>
		<header class="flex items-center justify-between border-b border-surface-300 px-4 py-3 dark:border-surface-600">
			<h2 class="text-base font-bold">Connections</h2>
			<button type="button" aria-label="Close" on:click={modalStore.close}><X size={16} /></button>
		</header>
		<!-- Narrow screens (the iPhone Duo folded) stack the list above the pane. -->
		<div class="connections-body flex h-[30rem] min-h-0 flex-col sm:flex-row">
			{#if view.showList}
				<nav
					class="max-h-32 w-full shrink-0 overflow-y-auto border-b border-surface-300 py-2 dark:border-surface-600 sm:max-h-none sm:w-56 sm:border-b-0 sm:border-r"
					aria-label="Connections"
				>
					{#each view.listed as c (c.id)}
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
					<button type="button" class={row(view.pane !== "detail")} data-testid="add-connection-item" on:click={() => (picked = "add")}>
						<Plus size={14} class="shrink-0 opacity-70" /> Add connection
					</button>
				</nav>
			{/if}
			<section class="min-w-0 flex-1 overflow-y-auto px-5 py-4">
				{#if view.pane === "pair"}
					<PairConnection on:added={(e) => added(e.detail)} />
				{:else if view.pane === "add"}
					<AddConnection on:added={(e) => added(e.detail)} />
				{:else}
					{#key view.connection.id}<ConnectionDetail connection={view.connection} />{/key}
				{/if}
			</section>
		</div>
	</div>
{/if}

<style>
	/* The mobile layout (html.mobile, lib/platform.js). The selectors are
	   global, as app.css's shared mobile rules are, so they weigh the same
	   against Skeleton's and Tailwind's classes. */
	/* Parts sized for a floating box grow into the sheet instead. */
	:global(html.mobile .connections-modal) {
		display: flex;
		flex-direction: column;
	}
	:global(html.mobile .connections-body) {
		flex: 1 1 0;
		height: auto;
	}
</style>
