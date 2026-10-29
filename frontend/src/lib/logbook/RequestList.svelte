<script>
	// A record's linked requests as rows to pick from: number, method, host
	// and path, and status, read with `read` as each row shows.
	import { METHOD_CLASS, statusClass } from "../launchpad/format.js";

	/** The linked requests' IDs. */
	export let ids = [];
	/** Reads a pair in full (GetRawDetails), id -> Promise<row>. */
	export let read;
	/** The picked request's ID. */
	export let selected = null;

	// Each row's pair once read: undefined while it loads, null if it is gone.
	let rows = {};
	$: for (const id of ids) if (!(id in rows)) load(id);
	async function load(id) {
		rows[id] = undefined;
		const row = await read(id).catch(() => null);
		rows = { ...rows, [id]: row };
	}
</script>

<div class="logbook-requests min-h-0 overflow-auto">
	{#each ids as id (id)}
		{@const pair = rows[id]}
		{@const on = String(selected) === String(id)}
		<button
			type="button"
			class="relative flex h-7 w-full items-center gap-2 pl-2 pr-1 text-left font-mono text-2xs {on
				? 'bg-primary-500/20'
				: 'hover:bg-surface-200/70 dark:hover:bg-surface-700/60'}"
			aria-current={on ? "true" : undefined}
			on:click={() => (selected = id)}
		>
			{#if on}<span class="absolute bottom-0 left-0 top-0 w-[3px] bg-primary-500"></span>{/if}
			{#if pair}
				<span class="w-9 flex-none text-right opacity-60">#{pair.Request?.Number}</span>
				<span class="w-12 flex-none {METHOD_CLASS[pair.Request?.Method] ?? ''}">{pair.Request?.Method}</span>
				<span class="min-w-0 flex-1 truncate" title="{pair.Request?.Host}{pair.Request?.Path}"
					>{pair.Request?.Host}{pair.Request?.Path}</span
				>
				<span class="flex-none {statusClass(pair.Response?.StatusCode)}">{pair.Response?.StatusCode || ""}</span>
			{:else}
				<span class="min-w-0 flex-1 truncate opacity-50">{pair === null ? "Request not found" : "Loading…"}</span>
			{/if}
		</button>
	{:else}
		<p class="px-2 py-3 text-center text-2xs opacity-60">No requests linked</p>
	{/each}
</div>
