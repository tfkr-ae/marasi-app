<script>
	// The Checkpoint page: the dock lists every intercepted item, grouped by
	// host; the workspace shows the selected item, or the rules behind its
	// Item | Rules switch. State lives in checkpointStore (see
	// stores/createCheckpointStore.js); this file wires the actions, the
	// confirmations, the toasts and the checkpoint.* shortcuts.
	import { onDestroy, onMount } from "svelte";
	import { getDrawerStore, getModalStore, getToastStore, modeCurrent } from "@skeletonlabs/skeleton";
	import { CornerLeftDown, EditIcon, FileCode, FilePenLine, Forward, SquarePlay, ToggleLeft } from "lucide-svelte";
	import { GetRawDetails, GetWebSocketConnection, RunExtension } from "../../lib/wailsjs/go/main/App";
	import MarasiKeys from "../../lib/components/MarasiMenu/MarasiKeys.svelte";
	import { useMenuActions } from "../../lib/keybindings/app.js";
	import { checkpointStore } from "../../stores/checkpointStore";
	import { launchpadStore } from "../../stores/launchpadStore";
	import { checkpointCode, checkpointCodeApplied, interceptFlag } from "../../stores";
	import { primaryVariant, UNTITLED_LAUNCHPAD } from "../../lib/launchpad/format.js";
	import CheckpointDock from "../../lib/checkpoint/CheckpointDock.svelte";
	import ItemWorkspace from "../../lib/checkpoint/ItemWorkspace.svelte";
	import RulesEditor from "../../lib/checkpoint/RulesEditor.svelte";
	import { createItemContext, keyOf } from "../../lib/checkpoint/itemContext.js";
	import { abandonText, dropTitle, groupByHost, itemTitle, summarize, treeOrder } from "../../lib/checkpoint/items.js";

	const toastStore = getToastStore();
	const modalStore = getModalStore();
	const drawerStore = getDrawerStore();
	const store = checkpointStore;
	const itemContext = createItemContext({
		getRow: (id) => GetRawDetails(id),
		getConnection: (id) => GetWebSocketConnection(id),
	});

	/** "item" or "rules": the workspace's Item | Rules switch. */
	let view = "item";
	let collapsed = new Set();
	let workspace;
	let rulesEditor;

	let now = Date.now();
	const clock = setInterval(() => (now = Date.now()), 1000);
	onDestroy(() => clearInterval(clock));

	$: state = $store;
	$: itemContext.load(state.items);
	$: primary = primaryVariant($modeCurrent);
	$: rulesChanged = $checkpointCode !== $checkpointCodeApplied;

	// The launchpad an item was launched from: a launch's id is its pair's id.
	function launchpadNameOf(id, lp) {
		const launch = lp.launchesById[id];
		if (!launch) return null;
		const launchpad = lp.launchpads.find((l) => l.ID === launch.LaunchpadID);
		return launchpad?.Name || UNTITLED_LAUNCHPAD;
	}

	function entryOf(item, contexts, lp) {
		const context = contexts[keyOf(item)];
		return {
			ID: item.ID,
			item,
			context,
			summary: summarize(item, item.text, context),
			launch: item.Type === "websocket" ? null : launchpadNameOf(item.ID, lp),
		};
	}

	// Labels come from the text as held, so an edit doesn't move an item.
	$: entries = state.items.map((item) => entryOf(item, $itemContext, $launchpadStore));
	$: groups = groupByHost(entries, (entry) => entry.summary.host);
	$: selected = entries.find((entry) => entry.ID === state.selectedId) ?? null;
	$: index = selected ? entries.indexOf(selected) : -1;

	function toast(message, background = "variant-filled-surface") {
		toastStore.trigger({ message, background, timeout: 3000 });
	}
	function failed(what, err) {
		console.error(`${what} failed:`, err);
		toast(`${what} failed`, "variant-filled-error");
	}

	async function forward(id, options = {}) {
		if (!id) return;
		try {
			if (!(await store.forward(id, options))) toast("Edit doesn't parse", "variant-filled-warning");
		} catch (err) {
			failed("Forward", err);
		}
	}

	async function drop(id) {
		if (!id) return;
		try {
			await store.drop(id);
		} catch (err) {
			failed("Drop", err);
		}
	}

	async function runBulk(kind, ids) {
		try {
			const result = await store.bulk(kind, ids);
			toast(result.text, "variant-filled-success");
		} catch (err) {
			failed(kind === "forward" ? "Forward" : "Drop", err);
		}
	}

	// Forward n doesn't ask; Drop n does. Both act on the ids at the click.
	function bulk(kind, ids) {
		const snapshot = [...ids];
		if (!snapshot.length) return;
		if (kind === "forward") return runBulk(kind, snapshot);
		modalStore.trigger({
			type: "confirm",
			title: dropTitle(snapshot.length),
			body: "",
			buttonTextConfirm: "Drop",
			response: (ok) => ok && runBulk(kind, snapshot),
		});
	}

	async function toggleIntercept() {
		try {
			await store.toggleIntercept();
		} catch (err) {
			failed("Intercept all", err);
		}
	}

	async function updateRules() {
		const code = $checkpointCode;
		try {
			await RunExtension("checkpoint", code);
			checkpointCodeApplied.set(code);
			toast("Rules updated", "variant-filled-success");
		} catch (err) {
			failed("Update rules", err);
		}
	}

	function showRules(focus = false) {
		view = "rules";
		if (focus) setTimeout(() => rulesEditor?.focusEditor(), 0);
	}

	function showItem(focus = false) {
		view = "item";
		if (focus) setTimeout(() => workspace?.focusEditor(), 0);
	}

	// ↑/↓ move the selection in the tree's on-screen order, outside editors,
	// fields and modals.
	function onKeydown(event) {
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
		if (event.metaKey || event.ctrlKey || event.altKey || $modalStore.length) return;
		if (event.target?.closest?.("input, textarea, select, [contenteditable], .cm-editor")) return;
		const order = treeOrder(groups, collapsed);
		if (!order.length) return;
		event.preventDefault();
		const at = order.indexOf(state.selectedId);
		const step = event.key === "ArrowDown" ? 1 : -1;
		const next = order[Math.min(order.length - 1, Math.max(0, at < 0 ? 0 : at + step))];
		if (next && next !== state.selectedId) store.pick(next);
	}

	// Marasi dropped an item because its client left.
	onMount(() =>
		store.onAbandon(({ item, editLost }) => {
			const context = $itemContext[keyOf(item)];
			const summary = summarize(item, item.text, context);
			const number = context?.request?.Number;
			const label = number ? `#${number}` : itemTitle(summary);
			toast(abandonText(label, editLost), editLost ? "variant-filled-warning" : "variant-filled-surface");
		}),
	);

	const checkpointMenu = [
		{
			actionId: "checkpoint.toggle-settings",
			icon: ToggleLeft,
			handler: () => (view === "rules" ? showItem() : showRules()),
		},
		{
			actionId: "checkpoint.edit-rules",
			icon: EditIcon,
			handler: () => showRules(true),
		},
		{
			actionId: "checkpoint.update-rules",
			icon: SquarePlay,
			handler: updateRules,
		},
		{
			actionId: "checkpoint.edit-intercepted",
			icon: FilePenLine,
			handler: () => selected && showItem(true),
		},
		{
			actionId: "checkpoint.forward-intercepted",
			icon: Forward,
			handler: () => forward(state.selectedId),
		},
		{
			actionId: "checkpoint.drop-intercepted",
			icon: CornerLeftDown,
			handler: () => drop(state.selectedId),
		},
		{
			actionId: "checkpoint.show-logs",
			icon: FileCode,
			handler: () => {
				if ($drawerStore.open) return drawerStore.close();
				drawerStore.open({
					id: "extension-logs",
					meta: { extensionName: "checkpoint" },
					height: "h-full",
					width: "w-3/5",
					position: "right",
				});
			},
		},
	];
	useMenuActions(checkpointMenu);

	const tab = (on) =>
		`-mb-px flex items-center gap-1 border-b-2 px-2 pb-1 ${on ? "border-primary-500 font-bold" : "border-transparent opacity-70 hover:opacity-100"}`;
</script>

<svelte:window on:keydown={onKeydown} />
<MarasiKeys menuOptions={checkpointMenu} />

<div class="cp-page relative flex h-full min-h-0">
	<CheckpointDock {store} {groups} {now} bind:collapsed onBulk={bulk} onToggleIntercept={toggleIntercept} />

	<div class="flex min-w-0 flex-1 flex-col">
		<div class="cp-switch flex items-center gap-1 border-b border-surface-500/30 bg-surface-50 px-3 pt-1.5 text-xs dark:bg-surface-900" role="tablist">
			<button class={tab(view === "item")} role="tab" aria-selected={view === "item"} on:click={() => showItem()}>Item</button>
			<button class={tab(view === "rules")} role="tab" aria-selected={view === "rules"} on:click={() => showRules()}>
				<FileCode size={12} />Rules
				{#if rulesChanged}<span class="text-warning-500" title="Not applied">●</span>{/if}
			</button>
		</div>
		<div class="min-h-0 flex-1">
			{#if view === "rules"}
				<RulesEditor bind:this={rulesEditor} onUpdate={updateRules} />
			{:else if selected}
				<ItemWorkspace
					bind:this={workspace}
					{store}
					entry={selected}
					{index}
					total={entries.length}
					{now}
					onForward={forward}
					onDrop={drop}
				/>
			{:else}
				<div class="cp-empty flex h-full flex-col items-center justify-center gap-2">
					<div class="text-center opacity-60">
						<h3 class="text-base font-bold">Nothing intercepted</h3>
						<p class="text-xs">{$interceptFlag ? "Intercept all is on" : "Rules decide what's intercepted"}</p>
					</div>
					<button class="btn btn-sm {primary}" on:click={() => showRules(true)}>
						<FileCode size={14} class="mr-1" />Edit rules
					</button>
				</div>
			{/if}
		</div>
	</div>
</div>
