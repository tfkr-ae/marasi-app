<script>
	// The iOS app's bottom bar, in place of the app rail on a narrow screen
	// (the iPhone Duo folded, an iPhone): app.css shows it, and hides the
	// rail, under 40rem; wider, the rail is back and this stays hidden. It
	// holds the main pages, Connections, and More, which opens a sheet
	// upwards with every other page, Settings and the Color Scheme tile. It
	// hides while the keyboard is up, so editors keep the room.
	import { onMount } from "svelte";
	import { page } from "$app/stores";
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import { setLightMode } from "../lightMode.js";
	import { ChevronDown, ChevronUp, Laptop, Moon, Server, Sun } from "lucide-svelte";
	import { connectionStore } from "../../stores/connectionStore.js";
	import { phaseLabel, phaseTone } from "../connection/status.js";

	/** The bar's pages: { id, label, icon, path, go, badge? }. */
	export let primary = [];
	/** The More sheet's pages, the same shape; `dot` marks one (an update). */
	export let more = [];
	export let onConnections = () => {};

	let open = false;
	let keyboard = false;
	// The bar's height while in view, as
	// --bottom-bar-height: modals, drawers and toasts stop above it (app.css).
	let height = 0;
	$: if (typeof document !== "undefined") document.documentElement.style.setProperty("--bottom-bar-height", `${height}px`);

	$: path = $page.url.pathname;
	$: connection = $connectionStore.connection;
	$: phase = $connectionStore.phase;
	$: moreSelected = more.some((item) => isAt(item, path));

	function isAt(item, current) {
		return item.path === "/" ? current === "/" : current === item.path || current.startsWith(item.path + "/");
	}
	function choose(item) {
		open = false;
		item.go();
	}
	// The Color Scheme tile flips light and dark, as ⌘U and the Settings
	// switch do ($modeCurrent is true in light).
	const toggleScheme = () => setLightMode(!$modeCurrent);
	function connections() {
		open = false;
		onConnections();
	}

	onMount(() => {
		const viewport = window.visualViewport;
		if (!viewport) return;
		// The keyboard takes the bottom of the screen: the visual viewport
		// comes up well short of the window.
		const measure = () => (keyboard = window.innerHeight - viewport.height > 120);
		viewport.addEventListener("resize", measure);
		return () => {
			viewport.removeEventListener("resize", measure);
			document.documentElement.style.removeProperty("--bottom-bar-height");
		};
	});

	// A tile as the rail draws one (routes/+layout.svelte): its icon only,
	// the selected one filled with the primary colour.
	const tab = (on) =>
		`bottom-bar-tile relative flex min-w-0 flex-1 items-center justify-center py-3 ${on ? "bg-primary-active-token" : ""}`;
</script>

{#if open}
	<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
	<div class="bottom-bar-backdrop fixed inset-0 bg-black/30" on:click={() => (open = false)}></div>
{/if}

<nav
	class="bottom-bar no-select relative flex-none border-t border-surface-500/30"
	class:bottom-bar-hidden={keyboard}
	class:bottom-bar-open={open}
	aria-label="Pages"
	bind:offsetHeight={height}
>
	{#if open}
		<div
			class="bottom-bar-sheet absolute bottom-full left-0 right-0 border-t border-surface-500/30 shadow-2xl"
			role="dialog"
			aria-label="More pages"
		>
			<div class="grid grid-cols-4">
				{#each more as item (item.id)}
					{@const on = isAt(item, path)}
					<button
						type="button"
						class="relative flex flex-col items-center justify-center gap-1 py-3 text-2xs font-semibold leading-tight {on
							? 'bg-primary-active-token'
							: ''}"
						aria-current={on ? "page" : undefined}
						on:click={() => choose(item)}
					>
						<span class="relative">
							<svelte:component this={item.icon} size="20" />
							{#if item.badge}
								<span
									class="badge-icon variant-filled-primary absolute left-1/2 -top-1.5 ml-1 h-auto min-w-[1.125rem] w-auto px-1 py-px text-3xs leading-none ring-2 ring-surface-50 dark:ring-surface-800"
									>{item.badge}</span
								>
							{/if}
							{#if item.dot}
								<span
									class="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full ring-2 ring-surface-50 dark:ring-surface-800 {item.dot}"
								></span>
							{/if}
						</span>
						<span class="max-w-full truncate px-1">{item.label}</span>
					</button>
				{/each}
				<!-- The Color Scheme switch, as the grid's last tile. -->
				<button
					type="button"
					class="flex flex-col items-center justify-center gap-1 py-3 text-2xs font-semibold leading-tight"
					aria-label="Color Scheme: {$modeCurrent ? 'light' : 'dark'}"
					on:click={toggleScheme}
				>
					{#if $modeCurrent}<Sun size="20" />{:else}<Moon size="20" />{/if}
					<span class="max-w-full truncate px-1">{$modeCurrent ? "Light" : "Dark"}</span>
				</button>
			</div>
		</div>
	{/if}

	<div class="flex items-stretch">
		{#each primary as item (item.id)}
			{@const on = !open && isAt(item, path)}
			<button
				type="button"
				class={tab(on)}
				title={item.label}
				aria-label={item.label}
				aria-current={on ? "page" : undefined}
				data-testid="bottom-bar-{item.id}"
				on:click={() => choose(item)}
			>
				<span class="relative">
					<svelte:component this={item.icon} size="20" />
					{#if item.badge}
						<span
							class="badge-icon variant-filled-primary absolute left-1/2 -top-1.5 ml-1 h-auto min-w-[1.125rem] w-auto px-1 py-px text-3xs leading-none ring-2 ring-surface-50 dark:ring-surface-800"
							>{item.badge}</span
						>
					{/if}
				</span>
			</button>
		{/each}
		<button
			type="button"
			class={tab(false)}
			title="{connection.name} · {phaseLabel(phase)}"
			aria-label="Connections"
			data-testid="bottom-bar-connections"
			on:click={connections}
		>
			<span class="relative">
				{#if connection.kind === "local"}<Laptop size="20" />{:else}<Server size="20" />{/if}
				<span
					class="absolute -right-1.5 -top-1 h-2.5 w-2.5 rounded-full ring-2 ring-surface-50 dark:ring-surface-800 {phaseTone(phase)}"
					class:animate-pulse={phase === "reconnecting"}
				></span>
			</span>
		</button>
		<button
			type="button"
			class="bottom-bar-more {tab(open || moreSelected)}"
			title="More"
			aria-expanded={open}
			aria-label="More pages"
			data-testid="bottom-bar-more"
			on:click={() => (open = !open)}
		>
			{#if open}<ChevronDown size="20" />{:else}<ChevronUp size="20" />{/if}
		</button>
	</div>
</nav>

<style>
	/* The mobile layout (html.mobile, lib/platform.js). The selectors are
	   global, as app.css's shared mobile rules are, so they weigh the same
	   against Skeleton's and Tailwind's classes. */
	/* ---- The narrow mobile bottom bar (BottomBar.svelte) ----
	   Under 40rem the app rail gives way to a bar along the bottom, under the
	   page. Its tiles run to the screen's bottom edge, so a selected one fills
	   to it, with the home indicator inside them, just below the icons (as
	   the rail's first tile holds the top inset). Wider, the rail is back
	   and the bar hides. While the keyboard is up the bar hides too. */
	:global(.bottom-bar) {
		display: none;
	}
	@media (max-width: 40rem) {
		:global(html.mobile .bottom-bar) {
			display: block;
		}
		/* The icons sit low, most of the inset under them taken back: only
		   the home indicator's own strip (about 40% of the inset) stays
		   clear below them. */
		:global(html.mobile .bottom-bar-tile) {
			padding-top: 0.625rem;
			padding-bottom: max(calc(var(--safe-bottom) * 0.4 + 0.375rem), 0.625rem);
		}
		:global(html.mobile .bottom-bar.bottom-bar-hidden) {
			display: none;
		}
		:global(html.mobile .bottom-bar),
		:global(html.mobile .bottom-bar *) {
			-webkit-tap-highlight-color: transparent;
		}
	}
	/* The bar and its More sheet are solid, over the page and above the
	   sheet's backdrop. */
	:global(.bottom-bar-backdrop) {
		z-index: 1000;
	}
	:global(.bottom-bar) {
		z-index: 30;
		background-color: rgb(var(--color-surface-50));
		/* Its background runs edge to edge, under the side insets too (the
		frame drops its side padding and the page takes it, below); its
		tiles stay inside them, in line with the page. Only the last tile,
		More, reaches into the right inset, so filled it meets the edge. */
		padding-left: var(--safe-left);
		padding-right: var(--safe-right);
	}
	:global(.bottom-bar-more) {
		margin-right: calc(-1 * var(--safe-right));
		padding-right: var(--safe-right);
	}
	:global(.bottom-bar-sheet) {
		padding-left: var(--safe-left);
		padding-right: var(--safe-right);
	}
	:global(.bottom-bar.bottom-bar-open) {
		z-index: 1001;
	}
	:global(.bottom-bar-sheet) {
		background-color: rgb(var(--color-surface-50));
	}
	:global(html.dark .bottom-bar),
	:global(html.dark .bottom-bar-sheet) {
		background-color: rgb(var(--color-surface-800));
	}
</style>
