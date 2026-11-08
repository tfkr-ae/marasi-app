<script>
	// A square icon button in the Keybindings rows (Add binding, Reset), on
	// the theme's primary variant with app.css hover, so every row's buttons
	// line up and match the rest of the app.
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import { primaryVariant } from "../../launchpad/format.js";

	export let title;
	export let label; // aria-label
	export let disabled = false;
</script>

<button
	type="button"
	class="btn h-8 w-8 shrink-0 rounded-none p-0 {primaryVariant($modeCurrent)}"
	{disabled}
	{title}
	aria-label={label}
	on:click><slot /></button
>
