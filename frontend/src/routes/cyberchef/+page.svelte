<script>
	// The CyberChef page: the open project's Recipes as tabs over CyberChef's
	// own UI (lib/tools/cyberchef). Recipes live in toolDocuments
	// (lib/tools/documents.js), so they stay when the page unmounts.
	import { get } from "svelte/store";
	import { getModalStore, getToastStore, modeCurrent } from "@skeletonlabs/skeleton";
	import { ChefHat, Copy, FilePlus, Paperclip, PanelRight, Pencil, Play, Replace, Trash2 } from "lucide-svelte";
	import MarasiMenu from "../../lib/components/MarasiMenu/MarasiMenu.svelte";
	import { useMenuActions } from "../../lib/keybindings/app.js";
	import DocumentTabs from "../../lib/tools/DocumentTabs.svelte";
	import InsertPanel from "../../lib/tools/InsertPanel.svelte";
	import AttachDialog from "../../lib/tools/AttachDialog.svelte";
	import ChefFrame from "../../lib/tools/cyberchef/ChefFrame.svelte";
	import { recipes } from "../../lib/tools/documents.js";
	import { deleteDocument, renameDocument, switchDocument } from "../../lib/tools/documentPrompts.js";
	import { recipeKind } from "../../lib/tools/toolDocuments.js";
	import { chefInbox, drainInbox } from "../../lib/tools/cyberchef/send.js";
	import { recipeFile } from "../../lib/tools/cyberchef/recipeFile.js";
	import { ledgerStore } from "../../stores/ledgerStore.js";
	import { RAW_ONLY } from "../../stores/trafficApi.js";
	import { toastError } from "../../lib/toasts.js";
	import { neutralVariant, primaryVariant } from "../../lib/launchpad/format.js";
	import { chefShown } from "../../lib/platform.js";

	const modalStore = getModalStore();
	const toastStore = getToastStore();

	$: current = $recipes.items.find((r) => r.id === $recipes.openId) ?? $recipes.items[0];

	let frame;
	let adapter = null;
	let loading = true;
	let failed = false;

	// Reads what CyberChef holds into the open recipe before copying or
	// judging it.
	const flush = () => frame?.flush();

	const rename = (id) => renameDocument(modalStore, recipes, id, "recipe");
	const remove = async (id) => {
		await flush();
		deleteDocument(modalStore, recipes, id, "recipe", recipeKind.isEmpty);
	};
	const duplicate = async () => {
		await flush();
		recipes.duplicate(current.id);
	};
	const switchRecipe = () => switchDocument(modalStore, recipes, "recipe", "cyberchef.switch-recipe");

	// Texts sent to CyberChef go in once the frame is ready, each by the
	// empty-tab rule (chefAdapter.insertInput), and are then recorded.
	let inserting = Promise.resolve();
	$: if (adapter && $chefInbox.length) {
		inserting = inserting
			.then(() => drainInbox(chefInbox, adapter))
			.then(flush)
			.catch((err) => toastError(toastStore, "Send to CyberChef failed", err));
	}

	function onError(event) {
		failed = true;
		toastError(toastStore, "CyberChef didn't load", event.detail.error);
	}

	// Insert: a pair's request, or its response (Res), goes in by the same
	// empty-tab rule as Send to CyberChef, through the inbox.
	let showInsert = false;
	async function insertPair(source, part) {
		try {
			const details = await ledgerStore.getDetails(source.id, RAW_ONLY);
			const raw = details?.[part]?.Raw;
			if (raw == null) {
				toastStore.trigger({ message: "No response yet", background: "variant-filled-warning" });
				return;
			}
			chefInbox.update((list) => [...list, raw]);
		} catch (err) {
			toastError(toastStore, "Insert failed", err);
		}
	}

	// Attach…: the open recipe, its inputs and the open tab's output, as one
	// text Artifact (recipeFile.js).
	function openAttach() {
		if (!adapter || get(modalStore)[0]) return;
		const id = current.id;
		const ready = adapter;
		modalStore.trigger({
			type: "component",
			component: {
				ref: AttachDialog,
				props: {
					documents: recipes,
					docId: id,
					noun: "recipe",
					formats: [],
					makeFile: async () => {
						await flush();
						const recipe = get(recipes).items.find((r) => r.id === id);
						return recipeFile(recipe, { output: await ready.getOutput(), openTab: ready.openTab() });
					},
				},
			},
			toggleAction: "cyberchef.attach",
		});
	}

	const menu = [
		{ actionId: "cyberchef.bake", icon: Play, handler: () => adapter?.bake() },
		{ actionId: "cyberchef.new-recipe", icon: FilePlus, handler: () => recipes.create() },
		{ actionId: "cyberchef.switch-recipe", icon: Replace, handler: switchRecipe },
		{ actionId: "cyberchef.rename-recipe", icon: Pencil, handler: () => rename(current.id) },
		{ actionId: "cyberchef.duplicate-recipe", icon: Copy, handler: duplicate },
		{ actionId: "cyberchef.insert", icon: PanelRight, handler: () => (showInsert = !showInsert) },
		{ actionId: "cyberchef.attach", icon: Paperclip, handler: openAttach },
		{ actionId: "cyberchef.delete-recipe", icon: Trash2, handler: () => remove(current.id) },
	];
	useMenuActions(menu);
</script>

<MarasiMenu paletteTier="page" pageName="CyberChef" pageEntries={menu} />

{#if !$chefShown}
	<div class="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs opacity-70">
		<ChefHat size="24" />
		CyberChef needs a wider screen.
	</div>
{:else}
	<div class="flex h-full min-h-0 flex-col" data-testid="cyberchef-page">
		<DocumentTabs documents={recipes} noun="recipe" onRename={rename} onDelete={remove}>
			<button type="button" class="btn btn-sm {neutralVariant($modeCurrent)}" on:click={duplicate}>Duplicate</button>
			<button
				type="button"
				class="btn btn-sm {showInsert ? primaryVariant($modeCurrent) : neutralVariant($modeCurrent)}"
				aria-pressed={showInsert}
				data-testid="cyberchef-insert"
				on:click={() => (showInsert = !showInsert)}>Insert</button
			>
			<button
				type="button"
				class="btn btn-sm {neutralVariant($modeCurrent)}"
				data-testid="cyberchef-attach"
				disabled={!adapter}
				on:click={openAttach}>Attach…</button
			>
		</DocumentTabs>
		<div class="flex min-h-0 flex-1">
		<div class="relative min-w-0 flex-1">
			<ChefFrame
				bind:this={frame}
				recipe={current}
				on:ready={(event) => (adapter = event.detail.adapter)}
				on:loading={(event) => (loading = event.detail)}
				on:change={(event) => recipes.change(event.detail.id, { operations: event.detail.operations, inputs: event.detail.inputs })}
				on:error={onError}
				on:saveRecipe={() => rename(current.id)}
				on:loadRecipe={switchRecipe}
			/>
			{#if loading || failed}
				<div class="absolute inset-0 flex items-center justify-center bg-surface-50/80 text-xs dark:bg-surface-900/80">
					{failed ? "CyberChef didn't load" : "Loading CyberChef…"}
				</div>
			{/if}
		</div>
		{#if showInsert}
			<aside class="flex w-80 max-w-[60%] shrink-0 flex-col border-l border-surface-500/30 bg-surface-50 dark:bg-surface-900">
				<InsertPanel
					kinds={["pair"]}
					title="Insert Input"
					onPick={(source) => insertPair(source, "Request")}
					onPickResponse={(source) => insertPair(source, "Response")}
					onClose={() => (showInsert = false)}
				/>
			</aside>
		{/if}
		</div>
	</div>
{/if}
