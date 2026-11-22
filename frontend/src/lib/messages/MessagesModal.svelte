<script>
	// The Messages modal's shell: the header (icon, title, message count,
	// progress chip, the kind's header action), the tab bar, the open tab,
	// the tab-stepping actions and the mobile layout. Everything specific to
	// a kind of message source comes from its definition (definitions.js):
	// its tabs with their components and menu actions, and a session that
	// gives the header, the header action and each tab's props.
	import {
		getModalStore,
		getToastStore,
		modeCurrent,
		TabGroup,
		Tab,
	} from "@skeletonlabs/skeleton";
	import { ChevronLeft, ChevronRight, Loader, XIcon } from "lucide-svelte";
	import { onDestroy } from "svelte";
	import { readable } from "svelte/store";
	import { primaryVariant } from "../launchpad/format.js";
	import MarasiMenu from "../components/MarasiMenu/MarasiMenu.svelte";
	import { useMenuActions } from "../keybindings/app.js";
	import { stepTab } from "./kinds.js";
	import { definitionFor } from "./definitions.js";

	const modalStore = getModalStore();
	const toastStore = getToastStore();

	const kind = definitionFor($modalStore[0]?.meta);
	let openTab = kind.tabs[0].id;
	const session = kind.session({
		meta: $modalStore[0]?.meta,
		toastStore,
		openTab: (id) => {
			openTab = id;
		},
	});
	const { header, tabProps } = session;
	// A count beside a tab's label (the Checkpoint tab's intercepted items), by tab id.
	const tabCounts = session.tabCounts ?? readable({});
	// The kind's header action (Close Connection), or none.
	const action = session.action;
	const actionEnabled = action?.enabled ?? readable(false);

	// Each tab's component instance, for its menu actions.
	const instances = {};
	let busy = false;

	function previousTab() {
		openTab = stepTab(kind, openTab, -1);
	}

	function nextTab() {
		openTab = stepTab(kind, openTab, 1);
	}

	async function runAction() {
		if (!action || !$actionEnabled || busy) return;
		busy = true;
		try {
			await action.run();
		} finally {
			busy = false;
		}
	}

	// Menu actions by context; labels and keys come from the catalog. All
	// handlers stay registered while the modal is open, and the open tab
	// (published through the kind's tabStore) decides which tab actions a
	// key reaches.
	const commonMenu = [
		{ actionId: kind.previousTabAction, icon: ChevronLeft, handler: previousTab },
		{ actionId: kind.nextTabAction, icon: ChevronRight, handler: nextTab },
		...(action ? [{ actionId: action.actionId, icon: action.icon, handler: runAction }] : []),
	];
	const tabMenus = Object.fromEntries(
		kind.tabs.map((tab) => [
			tab.id,
			tab.menu.map(({ actionId, icon, run }) => ({
				actionId,
				icon,
				handler: () => instances[tab.id] && run(instances[tab.id]),
			})),
		]),
	);

	useMenuActions([...commonMenu, ...Object.values(tabMenus).flat()]);

	$: kind.tabStore.set(openTab);
	onDestroy(() => {
		kind.tabStore.set(null);
		session.destroy?.();
	});

	$: pageEntries = [...commonMenu, ...tabMenus[openTab]];
	$: shown = kind.tabs.find((tab) => tab.id === openTab);
	$: props = $tabProps[openTab];
</script>

<MarasiMenu paletteTier="overlay" pageName={kind.page} {pageEntries} />

{#if $modalStore[0]}
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<div
		class="card p-4 text-sm w-[90%] max-w-[95vw] shadow-xl rounded-none flex flex-col max-h-[95vh] border-t-4 border-primary-500 bg-surface-50-800-token text-surface-900-50-token"
		on:keydown={(event) => {
			if (event.key === "Escape") {
				event.stopImmediatePropagation();
				modalStore.close();
			}
		}}
	>
		<header class="msg-header flex justify-between items-center gap-3">
			<div class="flex min-w-0 items-center gap-2">
				<svelte:component this={$header.icon} size={18} class={$header.iconClass} />
				<h2 class="truncate text-base font-bold">{$header.title}</h2>
				<span class="shrink-0 text-sm opacity-70">{$header.count}</span>
				{#if $header.chip}
					<span class="chip variant-soft-primary shrink-0 text-xs" title={$header.chipTitle}>
						<Loader size={12} class="animate-spin" />
						{$header.chip}
					</span>
				{/if}
			</div>

			<div class="flex items-center gap-2">
				{#if action}
					<button
						class="msg-header-action btn btn-sm {primaryVariant($modeCurrent)}"
						aria-label={action.label}
						title={action.label}
						disabled={!$actionEnabled || busy}
						on:click={runAction}
					>
						<span class="btn-content"
							><svelte:component this={action.icon} size={14} class="mr-1" /><span class="msg-label"
								>{busy ? action.busyLabel : action.label}</span
							></span
						>
					</button>
				{/if}
				<button class="text-2xl leading-none" aria-label="Close modal" on:click={modalStore.close}>
					<XIcon size={16} />
				</button>
			</div>
		</header>

		<div class="mt-2 flex w-full justify-center">
			<TabGroup class="msg-tabs" padding="px-3 py-1" regionList="text-sm">
				{#each kind.tabs as tab (tab.id)}
					<Tab bind:group={openTab} name={tab.id} value={tab.id}>
						<div class="flex items-center gap-2">
							<svelte:component this={tab.icon} size={14} />
							<span>{tab.label}</span>
							{#if $tabCounts[tab.id]}
								<span class="badge variant-filled-warning px-1.5 py-0 text-3xs" title="{$tabCounts[tab.id]} intercepted"
									>{$tabCounts[tab.id]}</span
								>
							{/if}
						</div>
					</Tab>
				{/each}
			</TabGroup>
		</div>

		<div class="mt-2 flex min-h-0 w-full flex-1 flex-col">
			<div class="h-[70vh] w-full min-w-0 overflow-hidden">
				{#if props}
					{#key openTab}
						<svelte:component this={shown.component} bind:this={instances[openTab]} {...props} />
					{/key}
				{:else}
					<div class="p-4 text-xs opacity-60">{session.missing}</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	/* The mobile layout (html.mobile, lib/platform.js). The selectors are
	   global, as app.css's shared mobile rules are, so they weigh the same
	   against Skeleton's and Tailwind's classes. */
	@media (max-width: 40rem) {
		:global(html.mobile .msg-label) {
			display: none;
		}
		:global(html.mobile .msg-header-action svg) {
			margin-right: 0;
		}
		:global(html.mobile .msg-tabs) {
			width: 100%;
		}
		:global(html.mobile .msg-tabs .tab-list) {
			display: flex;
		}
		:global(html.mobile .msg-tabs .tab-list > *) {
			flex: 1 1 0;
			min-width: 0;
			padding-left: 0.25rem;
			padding-right: 0.25rem;
			font-size: 0.75rem;
			text-align: center;
		}
		:global(html.mobile .msg-tabs .tab-list svg) {
			display: none;
		}
		:global(html.mobile .msg-tabs .tab-list div) {
			justify-content: center;
		}
		/* A tab's toolbar (msg-bar in the kinds' tab components) wraps. */
		:global(html.mobile .msg-bar) {
			flex-wrap: wrap;
			height: auto;
			min-height: 2.5rem;
			padding-top: 0.25rem;
			padding-bottom: 0.25rem;
			row-gap: 0.25rem;
		}
	}
</style>
