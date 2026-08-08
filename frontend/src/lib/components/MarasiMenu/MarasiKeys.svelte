<svelte:options accessors />

<script>
	import hotkeys from "hotkeys-js";
	import MenuItemList from "./MenuItemList.svelte";
	import { onMount } from "svelte";

	let dialog;

	let isOpen = false;
	let commandInput = "";
	let mounted = false;
	let boundOptions = [];
	let boundMenuOptions;
	let previousScope = "all";
	const commandKeys = "cmd+k, ctrl+k";

	export let menuOptions = [];
	export let scope = "all";
	export let persistOptions = false;
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
		event.detail.action.handler();
	}
	function handleCancel(event) {
		event.preventDefault();
		closeDialog();
	}
	function handleClose() {
		isOpen = false;
	}

	function handleCommandKey(event) {
		event.preventDefault();
		toggleDialog();
		return false;
	}

	function bindOptions(options) {
		options.forEach((option) => {
			const keys = Array.isArray(option.action.keys)
				? option.action.keys.join()
				: option.action.keys;
			const handler = () => {
				if (isOpen) toggleDialog();
				option.action.handler();
				return false;
			};
			hotkeys(keys, { ...option.action.options, scope }, handler);
			boundOptions.push({ keys, handler });
		});
	}

	function unbindOptions() {
		boundOptions.forEach(({ keys, handler }) => {
			hotkeys.unbind(keys, scope, handler);
		});
		boundOptions = [];
	}

	$: if (mounted && menuOptions !== boundMenuOptions) {
		unbindOptions();
		bindOptions(menuOptions);
		boundMenuOptions = menuOptions;
	}

	onMount(() => {
		previousScope = hotkeys.getScope();
		hotkeys.setScope(scope);
		hotkeys(commandKeys, { scope, single: true }, handleCommandKey);
		bindOptions(menuOptions);
		boundMenuOptions = menuOptions;
		mounted = true;
		return () => {
			mounted = false;
			if (persistOptions) boundOptions = [];
			else unbindOptions();
			hotkeys.unbind(commandKeys, scope, handleCommandKey);
			if (hotkeys.getScope() === scope) hotkeys.setScope(previousScope);
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
	on:cancel={handleCancel}
	on:click={handleClickOutside}
	on:keydown={(event) => {
		if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			event.stopImmediatePropagation();
			closeDialog();
		}
	}}
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
