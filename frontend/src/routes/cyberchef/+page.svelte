<script>
	// The CyberChef page: the open project's Recipes as tabs over CyberChef's
	// own UI (lib/tools/cyberchef). Recipes live in toolDocuments
	// (lib/tools/documents.js), so they stay when the page unmounts.
	import { getModalStore, getToastStore, modeCurrent } from "@skeletonlabs/skeleton";
	import { ChefHat, Copy, FilePlus, Paperclip, PanelRight, Pencil, Play, Replace, Trash2 } from "lucide-svelte";
	import MarasiMenu from "../../lib/components/MarasiMenu/MarasiMenu.svelte";
	import { useMenuActions } from "../../lib/keybindings/app.js";
	import DocumentTabs from "../../lib/tools/DocumentTabs.svelte";
	import ChefFrame from "../../lib/tools/cyberchef/ChefFrame.svelte";
	import { recipes } from "../../lib/tools/documents.js";
	import { deleteDocument, renameDocument, switchDocument } from "../../lib/tools/documentPrompts.js";
	import { recipeKind } from "../../lib/tools/toolDocuments.js";
	import { neutralVariant } from "../../lib/launchpad/format.js";
	import { phoneWidth } from "../../lib/platform.js";

	const modalStore = getModalStore();
	const toastStore = getToastStore();

	$: current = $recipes.items.find((r) => r.id === $recipes.openId) ?? $recipes.items[0];

	let frame;
	let adapter = null;
	let loading = true;
	let failed = "";

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

	function onError(event) {
		failed = event.detail.message;
		toastStore.trigger({ message: `CyberChef: ${failed}`, background: "variant-filled-error" });
	}

	// Insert Input… and Attach… arrive with their panels (issue 04).
	const menu = [
		{ actionId: "cyberchef.bake", icon: Play, handler: () => adapter?.bake() },
		{ actionId: "cyberchef.new-recipe", icon: FilePlus, handler: () => recipes.create() },
		{ actionId: "cyberchef.switch-recipe", icon: Replace, handler: switchRecipe },
		{ actionId: "cyberchef.rename-recipe", icon: Pencil, handler: () => rename(current.id) },
		{ actionId: "cyberchef.duplicate-recipe", icon: Copy, handler: duplicate },
		{ actionId: "cyberchef.insert", icon: PanelRight, handler: () => {} },
		{ actionId: "cyberchef.attach", icon: Paperclip, handler: () => {} },
		{ actionId: "cyberchef.delete-recipe", icon: Trash2, handler: () => remove(current.id) },
	];
	useMenuActions(menu);
</script>

<MarasiMenu paletteTier="page" pageName="CyberChef" pageEntries={menu} />

{#if $phoneWidth}
	<div class="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs opacity-70">
		<ChefHat size="24" />
		CyberChef needs a wider screen.
	</div>
{:else}
	<div class="flex h-full min-h-0 flex-col" data-testid="cyberchef-page">
		<DocumentTabs documents={recipes} noun="recipe" onRename={rename} onDelete={remove}>
			<button type="button" class="btn btn-sm {neutralVariant($modeCurrent)}" on:click={duplicate}>Duplicate</button>
			<button type="button" class="btn btn-sm {neutralVariant($modeCurrent)}" disabled>Insert</button>
			<button type="button" class="btn btn-sm {neutralVariant($modeCurrent)}" disabled>Attach…</button>
		</DocumentTabs>
		<div class="relative min-h-0 flex-1">
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
					{failed ? `CyberChef didn't load: ${failed}` : "Loading CyberChef…"}
				</div>
			{/if}
		</div>
	</div>
{/if}
