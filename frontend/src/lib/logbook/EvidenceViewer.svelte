<script>
	// A record's evidence: Requests and Artifacts tabs, each a list beside
	// (or above) a viewer: the request and response pair, or the artifact's
	// preview. The lists and viewers are their own components, so an editor
	// can put its own lists beside the same viewers.
	import ArtifactList from "./ArtifactList.svelte";
	import ArtifactPreview from "./ArtifactPreview.svelte";
	import RequestList from "./RequestList.svelte";
	import RequestPair from "./RequestPair.svelte";

	/** readPair, readArtifact and downloadArtifact, as the Logbook store has them. */
	export let store;
	/** Linked request IDs. */
	export let requests = [];
	/** ArtifactMetadata list. */
	export let artifacts = [];
	/** "split": the list beside the viewer; "stack": the list above it. */
	export let layout = "split";
	export let listWidth = 280;
	/** The request above the response inside the viewer. */
	export let stackPair = false;
	export let tab = "requests";

	// Each pair is read once per viewer: the list and the pair share it.
	const pairs = new Map();
	const read = (id) => {
		const key = String(id);
		if (!pairs.has(key)) pairs.set(key, store.readPair(id).catch(() => null));
		return pairs.get(key);
	};

	let request = requests[0] ?? null;
	let artifactID = artifacts[0]?.ID ?? null;
	$: if (!requests.some((id) => String(id) === String(request))) request = requests[0] ?? null;
	$: if (!artifacts.some((a) => String(a.ID) === String(artifactID))) artifactID = artifacts[0]?.ID ?? null;
	$: artifact = artifacts.find((a) => String(a.ID) === String(artifactID)) ?? null;
</script>

<div class="logbook-evidence flex h-full min-h-0 flex-col">
	<div class="flex h-9 flex-none items-center gap-1 border-b border-surface-500/30 px-2 text-xs" role="tablist">
		{#each [["requests", "Requests", requests.length], ["artifacts", "Artifacts", artifacts.length]] as [key, name, n]}
			<button
				type="button"
				role="tab"
				aria-selected={tab === key}
				class="relative flex h-full items-center gap-1 px-3 {tab === key ? 'font-bold' : 'opacity-70 hover:opacity-100'}"
				on:click={() => (tab = key)}
			>
				{name} <span class="text-3xs font-normal opacity-60">{n}</span>
				<!-- Overlays the row's bottom edge, so the label centres in the full row. -->
				{#if tab === key}<span class="absolute -bottom-px left-0 right-0 h-0.5 bg-primary-500"></span>{/if}
			</button>
		{/each}
		<slot name="tabs" />
	</div>
	<div class="flex min-h-0 flex-1 {layout === 'stack' ? 'flex-col' : ''}">
		<div
			class="flex min-h-0 flex-none flex-col p-1.5 {layout === 'stack'
				? 'max-h-[40%] border-b'
				: 'border-r'} border-surface-500/30"
			style={layout === "stack" ? "" : `width: ${listWidth}px`}
		>
			{#if tab === "requests"}
				<RequestList ids={requests} {read} bind:selected={request} />
			{:else}
				<ArtifactList {artifacts} bind:selected={artifactID} />
			{/if}
		</div>
		<div class="min-h-0 min-w-0 flex-1">
			{#if tab === "requests"}
				{#if request != null}
					<RequestPair id={request} {read} stack={stackPair} />
				{:else}
					<p class="p-8 text-center text-2xs opacity-60">No requests</p>
				{/if}
			{:else}
				<ArtifactPreview {artifact} {store} />
			{/if}
		</div>
	</div>
</div>
