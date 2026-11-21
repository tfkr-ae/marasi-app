<script>
	// An editor pane's Send to CyberChef button: sends the selection, or the
	// whole editor, of the editor in its pane, the nearest element marked
	// `data-chef-pane`. The global action (⌘E) sends from the last focused
	// editor instead. Hidden where the app has no CyberChef (chefShown).
	import { getToastStore } from "@skeletonlabs/skeleton";
	import { CookingPot } from "lucide-svelte";
	import { menuDispatcher } from "../../keybindings/app.js";
	import { shortcutLabel } from "../../keybindings/keys.js";
	import { chefShown } from "../../platform.js";
	import { sendPaneToChef } from "./sendAction.js";

	const toastStore = getToastStore();

	$: key = shortcutLabel($menuDispatcher, "global.send-to-cyberchef");
	$: title = key ? `Send to CyberChef (${key})` : "Send to CyberChef";
</script>

{#if $chefShown}
	<button
		type="button"
		class="send-to-chef flex items-center opacity-60"
		{title}
		aria-label="Send to CyberChef"
		on:mousedown|preventDefault
		on:click={(event) => sendPaneToChef(event.currentTarget.closest("[data-chef-pane]"), toastStore)}
	>
		<CookingPot size={12} />
	</button>
{/if}
