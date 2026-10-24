<script>
	// The raw request template, with Armory's placeholder completion. Fills
	// its container; the parent sets the height. `focus()` puts the cursor
	// in it.
	import CodeMirror from "svelte-codemirror-editor";
	import { StreamLanguage } from "@codemirror/language";
	import { http } from "@codemirror/legacy-modes/mode/http";
	import { oneDark } from "@codemirror/theme-one-dark";
	import { githubLight } from "@uiw/codemirror-theme-github";
	import { vim } from "@replit/codemirror-vim";
	import { autocompletion } from "@codemirror/autocomplete";
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import { armoryCompletionSource } from "../autocomplete/armory";
	import { longStrings } from "../longStrings.js";
	import { lineWrap, marasiConfig } from "../../stores";

	export let value = "";

	let container;

	export function focus() {
		container?.querySelector(".cm-content")?.focus();
	}
</script>

<div bind:this={container} class="armory-editor h-full min-h-0 overflow-hidden dark:bg-[#282c34]">
	<CodeMirror
		bind:value
		class="text-xs"
		theme={$modeCurrent ? githubLight : oneDark}
		extensions={[
			...($marasiConfig.VimEnabled ? [vim()] : []),
			StreamLanguage.define(http),
			autocompletion({ override: [armoryCompletionSource] }),
			longStrings({ wrap: $lineWrap, mode: $marasiConfig.WrapMode }),
		]}
	/>
</div>

<style>
	.armory-editor :global(.codemirror-wrapper),
	.armory-editor :global(.cm-editor) {
		height: 100%;
	}
</style>
