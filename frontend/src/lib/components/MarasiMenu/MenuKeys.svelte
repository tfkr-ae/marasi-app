<script>
	// Key badges for the Marasi menu: one per binding. The system font draws
	// ⌘ ⇧ ⌥ at full size; light grey with dark text in light mode, dark grey
	// with white text in dark mode.
	import { formatBinding } from "../../keybindings/keys.js";

	export let bindings = [];
	export let platform;
</script>

{#each bindings as binding}
	<kbd
		class="inline-flex h-6 min-w-[1.5rem] items-center justify-center border border-surface-300 bg-surface-100 px-1.5 font-sans text-xs font-medium leading-none tracking-wide text-surface-900 dark:border-surface-500 dark:bg-surface-700 dark:text-white"
		>{formatBinding(binding, platform)}</kbd
	>
{/each}
