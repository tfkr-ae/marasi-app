<script>
	// Checkpoint's Stream intercept switch, as the dock and the Messages
	// modal's Checkpoint tab show it. `class` names the wrapper for layout.
	import { SlideToggle } from "@skeletonlabs/skeleton";

	/** Whether Stream intercept is on. */
	export let checked = false;
	export let onToggle = () => {};
	let className = "";
	export { className as class };
</script>

<div class={className} title="Intercept every stream message and trailer block">
	<SlideToggle name="Stream intercept" size="sm" active="bg-success-500" {checked} on:change={onToggle}
		><span class="whitespace-nowrap text-xs">Stream intercept</span></SlideToggle
	>
</div>
