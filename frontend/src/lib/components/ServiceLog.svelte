<script>
	// The Service log in the app drawer (AppDrawer, id SERVICE_LOG_DRAWER):
	// the service's own messages, newest first, joined live by log.added
	// (homeStore). The level filter and opening a line's pair are in
	// serviceLog.js.
	import { getDrawerStore, getToastStore } from "@skeletonlabs/skeleton";
	import { goto } from "$app/navigation";
	import { ArrowUpRight, X } from "lucide-svelte";
	import { homeStore } from "../../stores/homeStore";
	import { ledgerStore } from "../../stores/ledgerStore";
	import { NO_BODIES, pairQuery } from "../../stores/trafficApi.js";
	import { service } from "../service/index.js";
	import { mobile } from "../platform.js";
	import { LEVEL_FILTERS, canOpenPair, filterByLevel, openPair } from "../serviceLog.js";

	const drawerStore = getDrawerStore();
	const toastStore = getToastStore();

	let level = "all";
	$: lines = filterByLevel($homeStore.logs, level).toReversed();
	$: extensionNames = $homeStore.extensionNames;

	const levelTone = {
		ERROR: "text-error-600 dark:text-error-400",
		FATAL: "text-error-600 dark:text-error-400",
		WARN: "text-warning-700 dark:text-warning-400",
		WARNING: "text-warning-700 dark:text-warning-400",
	};
	const time = (at) =>
		new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
	const source = (line) => (line.ExtensionID ? (extensionNames[line.ExtensionID] ?? "") : "");

	const pairNumber = (id) =>
		service
			.get(`/traffic/${id}`, pairQuery(NO_BODIES))
			.then((pair) => pair?.number ?? null)
			.catch(() => null);

	async function open(line) {
		const opened = await openPair(line, {
			pairNumber,
			goto: (url) => {
				drawerStore.close();
				return goto(url);
			},
			ledger: ledgerStore,
		});
		if (!opened) toastStore.trigger({ message: "Pair not found", background: "variant-filled-warning" });
	}

	const seg = "inline-flex h-6 flex-none items-center px-2 text-2xs font-semibold";
</script>

<div class="flex h-full flex-col" data-testid="service-log">
	<div
		class="flex flex-none items-center gap-3 border-b border-surface-300-600-token px-4 py-2"
		class:service-log-head-mobile={$mobile}
	>
		<h3 class="text-sm font-bold">Service log</h3>
		<div
			class="inline-flex flex-none items-center border border-surface-300-600-token bg-surface-50 dark:bg-surface-900"
			role="tablist"
			aria-label="Level"
			data-testid="service-log-level"
		>
			{#each LEVEL_FILTERS as filter, i}
				<button
					type="button"
					role="tab"
					aria-selected={level === filter.id}
					class="{seg} {i ? 'border-l border-surface-300-600-token' : ''} {level === filter.id
						? 'bg-surface-200-700-token text-primary-500'
						: 'opacity-60 hover:opacity-90'}"
					on:click={() => (level = filter.id)}>{filter.label}</button
				>
			{/each}
		</div>
		<span class="flex-1"></span>
		{#if $mobile}
			<button
				type="button"
				class="flex h-9 w-9 items-center justify-center opacity-70"
				aria-label="Close"
				on:click={() => drawerStore.close()}><X size={18} /></button
			>
		{/if}
	</div>
	<div class="min-h-0 flex-1 overflow-y-auto">
		{#each lines as line (line.ID)}
			{@const opens = canOpenPair(line)}
			<svelte:element
				this={opens ? "button" : "div"}
				type={opens ? "button" : undefined}
				class="flex w-full items-baseline gap-3 border-b border-surface-300/60 px-4 py-1.5 text-left text-xs dark:border-surface-600/60 {opens
					? 'hover:bg-surface-200-700-token'
					: ''}"
				title={opens ? "Open the pair" : undefined}
				data-testid="service-log-line"
				on:click={opens ? () => open(line) : undefined}
			>
				<span class="w-10 shrink-0 text-2xs font-semibold {levelTone[String(line.Level).toUpperCase()] ?? 'opacity-60'}"
					>{line.Level}</span
				>
				<span class="min-w-0 flex-1 break-words">
					{line.Message}
					{#if source(line)}<span class="ml-1 text-2xs opacity-60">· {source(line)}</span>{/if}
				</span>
				{#if opens}<span class="shrink-0 self-center opacity-60"><ArrowUpRight size={12} /></span>{/if}
				<span class="shrink-0 font-mono text-2xs opacity-60">{time(line.Timestamp)}</span>
			</svelte:element>
		{:else}
			<p class="px-4 py-3 text-xs opacity-60">
				{$homeStore.logs.length ? "No messages at this level" : "No messages yet"}
			</p>
		{/each}
	</div>
</div>

<style>
	/* On a phone the drawer is a full-screen sheet with no backdrop to tap
	   (app.css), so the title row is as tall as a modal header and carries
	   a close button, as ExtensionLogs' does. */
	:global(html.mobile .service-log-head-mobile) {
		min-height: 3.5rem;
	}
</style>
