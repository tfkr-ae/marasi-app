<svelte:options accessors />

<script context="module">
	console.log("Loaded");
</script>

<script>
	import hotkeys from "hotkeys-js";
	import MenuItemList from "./MenuItemList.svelte";
	import { onMount } from "svelte";

	let dialog;

	let isOpen = false;
	let commandInput = "";

	export let menuOptions = [];
	export let scope = "all";
	export function toggleDialog() {
		if (!dialog) return;
		isOpen = !isOpen;
		if (isOpen) {
			dialog.showModal();
		} else {
			dialog.close();
		}
	}

	function handleClickOutside(event) {
		const rect = dialog.getBoundingClientRect();
		if (
			event.clientX < rect.left ||
			event.clientX > rect.right ||
			event.clientY < rect.top ||
			event.clientY > rect.bottom
		) {
			dialog.close();
		}
	}

	function onSelection(event) {
		if (isOpen) toggleDialog();
		event.detail.action.handler();
	}
	function handleClose() {
		isOpen = false;
	}

	hotkeys("cmd+k, ctrl+k", { single: true }, (event, _) => {
		event.preventDefault();
		toggleDialog();
	});

	$: menuOptions.forEach((option) => {
		hotkeys(option.action.keys.join(), option.action.options, () => {
			if (isOpen) toggleDialog();
			option.action.handler();
			return false;
		});
	});
	onMount(() => {
		hotkeys.setScope(scope);
		menuOptions.forEach((option) => {
			hotkeys(option.action.keys.join(), option.action.options, () => {
				if (isOpen) toggleDialog();
				option.action.handler();
				return false;
			});
		});
		return () => {
			// hotkeys.unbind();
		};
	});
</script>

<!-- 
  The native <dialog> element. 
  on:close runs if the user presses Esc or calls dialog.close() in script.
-->
<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<dialog
	class="w-modal text-white bg-neutral-800"
	bind:this={dialog}
	on:close={handleClose}
	on:click={handleClickOutside}
	on:keydown={(event) => {
		if (event.key === 'Escape') {
            event.stopImmediatePropagation();
			if (isOpen) toggleDialog();
        } 
	}}
>
	<input
		id="commandmenu"
		class="input w-full h-12 text-lg px-4"
		type="search"
		bind:value={commandInput}
		placeholder="Search..."
	/>
	<div class="card w-full" tabindex="-1">
		<MenuItemList
			bind:input={commandInput}
			options={menuOptions}
			on:selection={onSelection}
		/>
	</div>
</dialog>

<style>
	dialog::backdrop {
		background: rgba(0, 0, 0, 0.5);
	}
</style>

