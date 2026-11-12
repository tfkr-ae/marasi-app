<script>
	// Settings → Connection: the Connections modal's list and details, laid
	// out as a Settings section, with Add connection under the list, and
	// When quitting under the details. The iOS app lists only remotes, adds by
	// pairing, and has no When quitting: it runs no local instance
	// (pairing-view.js).
	import { Laptop, Plus, Server } from "lucide-svelte";
	import { getToastStore, modeCurrent } from "@skeletonlabs/skeleton";
	import { primaryButton } from "../launchpad/format.js";
	import { SetFlag } from "../bindings/github.com/tfkr-ae/marasi-app/app.js";
	import { marasiConfig } from "../../stores";
	import { toastError } from "../toasts.js";
	import { WHEN_QUITTING } from "./quitQuestion.js";
	import { connectionStore } from "../../stores/connectionStore.js";
	import AddConnection from "./AddConnection.svelte";
	import ConnectionDetail from "./ConnectionDetail.svelte";
	import PairConnection from "./PairConnection.svelte";
	import { connectionsView } from "./pairing-view.js";
	import { mobile } from "../platform.js";
	import { phaseLabel, phaseTone, whereText } from "./status.js";

	// A connection's id, or "add" for the add form.
	let picked = $connectionStore.connection.id;
	$: view = connectionsView({ mobile: $mobile, connections: $connectionStore.connections, picked });
	$: activeId = $connectionStore.connection.id;
	const toastStore = getToastStore();
	$: primary = primaryButton($modeCurrent);
	// Go reads anything but keep or stop as ask.
	$: whenQuitting = WHEN_QUITTING.some(([value]) => value === $marasiConfig?.WhenQuitting)
		? $marasiConfig.WhenQuitting
		: "ask";

	// As in the Connections modal, the iOS app switches to a new remote at once.
	function added(id) {
		picked = id;
		if ($mobile) connectionStore.switchTo(id);
	}

	function setWhenQuitting(value) {
		SetFlag("when_quitting", value)
			.then((config) => marasiConfig.set(config))
			.catch((error) => toastError(toastStore, "When quitting not saved", error));
	}
</script>

<h3 class="text-sm font-bold">Connection</h3>
<p class="text-xs opacity-70">Where Marasi runs.</p>

<div class="mt-3 border-y border-surface-300 dark:border-surface-600">
	{#each view.listed as c (c.id)}
		<button
			type="button"
			data-testid="connection-item"
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
	<button
		type="button"
		class="flex w-full items-center gap-3 px-2 py-2 text-left hover:bg-primary-500/10 {view.pane !== 'detail' ? '!bg-primary-500/20' : ''}"
		data-testid="add-connection-item"
		on:click={() => (picked = "add")}
	>
		<Plus size={14} class="opacity-70" /> Add connection
	</button>
</div>

<div class="mt-4">
	{#if view.pane === "pair"}
		<PairConnection on:added={(e) => added(e.detail)} />
	{:else if view.pane === "add"}
		<AddConnection on:added={(e) => added(e.detail)} />
	{:else}
		{#key view.connection.id}<ConnectionDetail connection={view.connection} rows />{/key}
	{/if}
</div>

{#if !$mobile}
<div
	class="settings-row flex items-center justify-between gap-8 border-b border-surface-300 py-3 dark:border-surface-600"
	data-testid="when-quitting"
>
	<p>When quitting</p>
	<div class="settings-control flex w-80 shrink-0 text-sm" role="radiogroup" aria-label="When quitting">
		{#each WHEN_QUITTING as [value, label]}
			<button
				type="button"
				role="radio"
				aria-checked={whenQuitting === value}
				class="flex-1 px-3 py-1 {whenQuitting === value
					? primary
					: 'bg-surface-200 hover:bg-surface-300 dark:bg-surface-700 dark:hover:bg-surface-600'}"
				on:click={() => setWhenQuitting(value)}>{label}</button
			>
		{/each}
	</div>
</div>
{/if}
