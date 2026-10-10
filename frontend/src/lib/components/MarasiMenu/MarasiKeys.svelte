<svelte:options accessors />

<script>
	import MenuItemList from "./MenuItemList.svelte";
	import { onMount } from "svelte";
	import {
		menuDispatcher,
		menuPalettes,
	} from "../../keybindings/app.js";

	let dialog;

	let isOpen = false;
	let commandInput = "";

	// Catalog entries: { actionId, icon }, optionally overriding name,
	// subtitle or keywords. Text, keys and handlers come from the catalog and
	// the central dispatcher. An entry without an actionId (an extension menu
	// item that declares no action) is listed without keys and runs nothing.
	export let menuOptions = [];
	// Menu-context tier of this menu: the menu shortcut opens the most
	// specific mounted menu (overlay, then page, then global).
	export let paletteTier = "page";
	export function toggleDialog() {
		if (!dialog) return;
		if (!dialog.open) {
			isOpen = true;
			dialog.showModal();
		} else {
			closeDialog();
		}
	}

	function closeDialog() {
		if (!dialog?.open) return;
		dialog.close();
	}

	function handleClickOutside(event) {
		const rect = dialog.getBoundingClientRect();
		if (
			event.clientX < rect.left ||
			event.clientX > rect.right ||
			event.clientY < rect.top ||
			event.clientY > rect.bottom
		) {
			closeDialog();
		}
	}

	function onSelection(event) {
		if (isOpen) closeDialog();
		const option = event.detail;
		if (option.actionId) menuDispatcher.run(option.actionId);
	}
	function handleCancel(event) {
		event.preventDefault();
		closeDialog();
	}
	function handleClose() {
		isOpen = false;
	}

	function withCatalogText(option, catalog) {
		const action = option.actionId && catalog.get(option.actionId);
		if (!action) return option;
		return {
			name: action.label,
			subtitle: action.description,
			keywords: action.keywords,
			...option,
		};
	}

	$: entries = menuOptions.map((option) =>
		withCatalogText(option, $menuDispatcher.catalog),
	);

	onMount(() =>
		menuPalettes.register(paletteTier, {
			toggle: toggleDialog,
		}),
	);
</script>

<!-- 
  The native <dialog> element. 
  on:close runs if the user presses Esc or calls dialog.close() in script.
-->
<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<dialog
	class="w-modal bg-surface-100-800-token text-surface-900-50-token"
	bind:this={dialog}
	on:close={handleClose}
	on:cancel={handleCancel}
	on:click={handleClickOutside}
	aria-label="Marasi commands"
	aria-modal="true"
>
	<input
		id="commandmenu"
		class="input w-full h-12 text-lg px-4"
		type="search"
		bind:value={commandInput}
		placeholder="Search..."
		aria-label="Search commands"
	/>
	<div class="card w-full" tabindex="-1">
		<MenuItemList
			bind:input={commandInput}
			options={entries}
			on:selection={onSelection}
		/>
	</div>
</dialog>

<style>
	dialog::backdrop {
		background: rgba(0, 0, 0, 0.5);
	}
</style>
