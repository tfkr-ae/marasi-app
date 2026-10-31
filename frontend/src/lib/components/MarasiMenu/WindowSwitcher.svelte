<svelte:options accessors />

<script>
	// Switch Window: the connected windows by instance and project, each
	// window one connection (docs/adr/2026-10-31-one-connection-per-window.md),
	// in the Marasi menu's style. Choosing one brings it to the front.
	import { AppWindow, AppWindowMac } from "lucide-svelte";
	import MenuItemList from "./MenuItemList.svelte";
	import { windowList } from "../../../stores/windowConnectionStore.js";

	let dialog;
	let input = "";

	export function toggle() {
		if (!dialog) return;
		if (dialog.open) dialog.close();
		else {
			input = "";
			dialog.showModal();
		}
	}

	function handleClickOutside(event) {
		const rect = dialog.getBoundingClientRect();
		const outside =
			event.clientX < rect.left ||
			event.clientX > rect.right ||
			event.clientY < rect.top ||
			event.clientY > rect.bottom;
		if (outside) dialog.close();
	}

	function onSelection(event) {
		dialog.close();
		windowList.switchTo(event.detail.window);
	}

	$: options = $windowList.map((window) => ({
		window,
		name: window.label,
		subtitle: window.current ? "This window" : "",
		keywords: `${window.instance} ${window.project ?? ""}`,
		icon: window.current ? AppWindowMac : AppWindow,
	}));
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<dialog
	class="w-modal bg-surface-100-800-token text-surface-900-50-token"
	bind:this={dialog}
	on:click={handleClickOutside}
	aria-label="Switch window"
	aria-modal="true"
>
	<input
		class="input w-full h-9 text-sm px-3"
		type="search"
		bind:value={input}
		placeholder="Search windows..."
		aria-label="Search windows"
	/>
	<div class="card w-full" tabindex="-1">
		<MenuItemList bind:input {options} emptyState="No connected windows." on:selection={onSelection} />
	</div>
</dialog>

<style>
	dialog::backdrop {
		background: rgba(0, 0, 0, 0.5);
	}
</style>
