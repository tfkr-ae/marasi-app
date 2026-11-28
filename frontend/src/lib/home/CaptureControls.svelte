<script>
	// Home's capture controls: the listener group (address, Stop/Start, Open
	// Project), Download Certificate, Start Chrome with its profiles (not on
	// a phone) and the Service log. From 40rem up they form a row that wraps
	// between controls, never inside one, so none is clipped; below it they
	// stack full-width, Open Project on its own row so the listener group fits. Every button is the same height, in text-xs.
	import { createEventDispatcher, onMount } from "svelte";
	import { modeCurrent, popup } from "@skeletonlabs/skeleton";
	import { ChevronDown, Download, FolderOpen, Play, ScrollText, Square } from "lucide-svelte";
	import { ChromeIcon } from "svelte-feather-icons";
	import { neutralVariant, primaryVariant } from "../launchpad/format.js";
	import { COMPACT_QUERY } from "../platform.js";
	export let listener = { status: false, address: "", port: "" };
	export let listenerBusy = false;
	export let chromeProfiles = [];
	export let mobile = false;
	const dispatch = createEventDispatcher();

	const compactQuery = typeof window !== "undefined" ? window.matchMedia(COMPACT_QUERY) : null;
	let compact = compactQuery?.matches ?? false;
	onMount(() => {
		const update = (e) => (compact = e.matches);
		compactQuery?.addEventListener("change", update);
		return () => compactQuery?.removeEventListener("change", update);
	});

	// One size for every button: the group's small padding, text-xs.
	const size = "btn btn-sm text-xs !px-3 !py-1.5 gap-1.5 whitespace-nowrap";
	$: neutral = `${size} ${neutralVariant($modeCurrent)}`;
	$: primary = `${size} ${primaryVariant($modeCurrent)}`;
	// Stacked, every button starts its icon and text at the same left edge.
	$: full = compact ? "w-full !justify-start" : "";
	const chromeProfilesPopup = { event: "click", target: "chromeProfilesPopup", placement: "bottom-end" };
</script>

<div class={compact ? "w-full space-y-2" : "flex min-w-0 flex-wrap items-center gap-2"} data-testid="home-capture">
	<div class="btn-group btn-group-sm [&>button]:!text-xs [&>button]:!px-3 [&>button]:!py-1.5 {full} {$modeCurrent ? 'light-ghost-group' : 'variant-filled'}">
		<button type="button" class="{neutral} {compact ? 'flex-1 min-w-0 !justify-start' : ''}" title="Change listener" on:click={() => dispatch("editListener")}>
			<span class="truncate font-mono text-2xs" data-testid="home-listener"
				>{listener.status ? `${listener.address}:${listener.port}` : "Listener off"}</span
			>
			<span class="flex w-2.5 h-2.5 shrink-0 rounded-full {listener.status ? 'bg-success-500' : 'bg-primary-500'}"></span>
		</button>
		<button
			type="button"
			class={neutral}
			data-testid="home-listener-toggle"
			disabled={listenerBusy}
			title={listener.status ? "Stop proxy listener" : "Start proxy listener"}
			aria-label={listener.status ? "Stop Listener" : "Start Listener"}
			on:click={() => dispatch("toggleListener")}
		>
			{#if listener.status}<Square size={14} /><span>Stop</span>{:else}<Play size={14} /><span>Start</span>{/if}
		</button>
		{#if !compact}
			<button type="button" class={neutral} title="Open Project" on:click={() => dispatch("openProject")}>
				<FolderOpen size={14} /><span>Open Project</span>
			</button>
		{/if}
	</div>
	{#if compact}
		<button type="button" class="{neutral} {full}" title="Open Project" on:click={() => dispatch("openProject")}>
			<FolderOpen size={14} /><span>Open Project</span>
		</button>
	{/if}
	<button type="button" class="{primary} {full}" on:click={() => dispatch("downloadCertificate")}>
		<Download size={14} /><span>Download Certificate</span>
	</button>
	{#if !mobile}
		<div class="flex overflow-hidden {full}">
			<button
				type="button"
				class="{primary} {compact ? 'flex-1 !justify-start' : ''}"
				class:rounded-none={chromeProfiles.length > 0}
				on:click={() => dispatch("startChrome", "")}
			>
				<ChromeIcon size="14" /><span>Start Chrome</span>
			</button>
			{#if chromeProfiles.length > 0}
				<button
					type="button"
					class="{primary} rounded-none !px-2"
					use:popup={chromeProfilesPopup}
					aria-label="Start Chrome with custom profile"
					title="Start with custom profile"
				>
					<ChevronDown size={14} />
				</button>
			{/if}
		</div>
		<div class="card z-10 w-48 bg-surface-100-800-token shadow-xl" data-popup="chromeProfilesPopup">
			{#each chromeProfiles as profile}
				<button
					type="button"
					class="w-full px-3 py-2 text-left text-xs hover:variant-soft-primary focus:variant-soft-primary"
					on:click={() => dispatch("startChrome", profile)}>{profile}</button
				>
			{/each}
		</div>
	{/if}
	<button type="button" class="{neutral} {full}" data-testid="home-service-log" on:click={() => dispatch("openServiceLog")}>
		<ScrollText size={14} /><span>Service log</span>
	</button>
</div>

<style>
	:global(.light-ghost-group .btn:hover) {
		background-color: rgb(var(--color-surface-400) / 0.25) !important;
	}
</style>
