<script>
	// The CyberChef page: the project's Recipes as tabs over CyberChef's own
	// UI (lib/tools/cyberchef). Recipes live in memory per project
	// (lib/tools/recipes.js), so they survive leaving the page.
	import { get } from "svelte/store";
	import { getModalStore, getToastStore } from "@skeletonlabs/skeleton";
	import { ChefHat, Copy, FolderOpen, PenLine, Play, Plus, Trash2 } from "lucide-svelte";
	import MarasiMenu from "../../lib/components/MarasiMenu/MarasiMenu.svelte";
	import { useMenuActions } from "../../lib/keybindings/app.js";
	import ChefFrame from "../../lib/tools/cyberchef/ChefFrame.svelte";
	import RecipeTabs from "../../lib/tools/cyberchef/RecipeTabs.svelte";
	import RecipePicker from "../../lib/tools/cyberchef/RecipePicker.svelte";
	import { isEmptyRecipe, recipes } from "../../lib/tools/recipes.js";
	import { loadedProject } from "../../stores/projectStore.js";
	import { phoneWidth } from "../../lib/platform.js";

	const toastStore = getToastStore();
	const modalStore = getModalStore();

	$: recipes.forProject($loadedProject?.path ?? null);
	$: current = $recipes.items.find((recipe) => recipe.id === $recipes.currentId) ?? $recipes.items[0];

	let frame;
	let adapter = null;
	let loading = true;
	let failed = "";
	let picking = false;

	const flush = () => frame?.flush();
	const byId = (id) => get(recipes).items.find((recipe) => recipe.id === id);

	async function create() {
		await flush();
		recipes.create();
	}

	async function open(id) {
		picking = false;
		await flush();
		recipes.open(id);
	}

	async function duplicate() {
		await flush();
		recipes.duplicate(current.id);
	}

	function rename(id = current.id) {
		const recipe = byId(id);
		if (!recipe) return;
		modalStore.trigger({
			type: "prompt",
			title: "Rename recipe",
			value: recipe.name,
			valueAttr: { type: "text", required: true },
			buttonTextSubmit: "Rename",
			toggleAction: "cyberchef.rename-recipe",
			response: (name) => typeof name === "string" && recipes.rename(id, name),
		});
	}

	// An empty recipe goes at once; one with operations or input asks first.
	async function remove(id = current.id) {
		await flush();
		const recipe = byId(id);
		if (!recipe) return;
		if (isEmptyRecipe(recipe)) return recipes.remove(id);
		modalStore.trigger({
			type: "confirm",
			title: "Delete recipe?",
			body: `${recipe.name} and its input are lost.`,
			buttonTextConfirm: "Delete",
			toggleAction: "cyberchef.delete-recipe",
			response: (yes) => yes && recipes.remove(id),
		});
	}

	function onChange(event) {
		const { id, operations, inputs } = event.detail;
		recipes.change(id, { operations, inputs });
	}

	function onError(event) {
		failed = event.detail.message;
		toastStore.trigger({ message: `CyberChef: ${failed}`, background: "variant-filled-error" });
	}

	const menu = [
		{ actionId: "cyberchef.bake", icon: Play, handler: () => adapter?.bake() },
		{ actionId: "cyberchef.new-recipe", icon: Plus, handler: create },
		{ actionId: "cyberchef.switch-recipe", icon: FolderOpen, handler: () => (picking = !picking) },
		{ actionId: "cyberchef.rename-recipe", icon: PenLine, handler: () => rename() },
		{ actionId: "cyberchef.duplicate-recipe", icon: Copy, handler: duplicate },
		{ actionId: "cyberchef.delete-recipe", icon: Trash2, handler: () => remove() },
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
		<RecipeTabs
			items={$recipes.items}
			currentId={current.id}
			on:open={(event) => open(event.detail)}
			on:rename={(event) => rename(event.detail)}
			on:delete={(event) => remove(event.detail)}
			on:create={create}
			on:duplicate={duplicate}
		/>
		<div class="relative min-h-0 flex-1">
			<ChefFrame
				bind:this={frame}
				recipe={current}
				on:ready={(event) => (adapter = event.detail.adapter)}
				on:loading={(event) => (loading = event.detail)}
				on:change={onChange}
				on:error={onError}
				on:saveRecipe={() => rename()}
				on:loadRecipe={() => (picking = true)}
			/>
			{#if loading || failed}
				<div class="absolute inset-0 flex items-center justify-center bg-surface-50/80 text-xs dark:bg-surface-900/80">
					{failed ? `CyberChef didn't load: ${failed}` : "Loading CyberChef…"}
				</div>
			{/if}
			{#if picking}
				<RecipePicker
					items={$recipes.items}
					currentId={current.id}
					on:open={(event) => open(event.detail)}
					on:close={() => (picking = false)}
				/>
			{/if}
		</div>
	</div>
{/if}
