<script>
	// Checkpoint's Lua rules at full width, with Update rules. ● marks rules
	// that differ from the ones Checkpoint runs.
	import CodeMirror from "svelte-codemirror-editor";
	import { StreamLanguage } from "@codemirror/language";
	import { lua } from "@codemirror/legacy-modes/mode/lua";
	import { oneDark } from "@codemirror/theme-one-dark";
	import { githubLight } from "@uiw/codemirror-theme-github";
	import { vim } from "@replit/codemirror-vim";
	import { autocompletion } from "@codemirror/autocomplete";
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import { SquarePlay } from "lucide-svelte";
	import { checkpointCode, checkpointCodeApplied, interceptFlag, marasiConfig } from "../../stores";
	import { marasiCompletionSource } from "../autocomplete/autocomplete";
	import { primaryVariant } from "../launchpad/format.js";

	export let onUpdate = () => {};

	$: primary = primaryVariant($modeCurrent);
	$: changed = $checkpointCode !== $checkpointCodeApplied;
	const luaLang = StreamLanguage.define(lua);
	const completion = autocompletion({ override: [marasiCompletionSource] });
	$: extensions = [...($marasiConfig.VimEnabled ? [vim()] : []), luaLang, completion];

	let editor;
	/** Focuses the rules editor. */
	export function focusEditor() {
		editor?.focus();
	}
</script>

<div class="flex h-full min-h-0 flex-col">
	<div class="cp-rules min-h-0 flex-1 overflow-auto dark:bg-[#282c34]">
		<CodeMirror
			bind:value={$checkpointCode}
			on:ready={(event) => (editor = event.detail)}
			class="text-xs"
			styles={{ "&": { fontSize: "11px" } }}
			theme={$modeCurrent ? githubLight : oneDark}
			{extensions}
		/>
	</div>
	<div class="flex items-center justify-end gap-3 border-t border-surface-500/30 px-3 py-1.5 text-[11px]">
		{#if changed}<span class="cp-rules-changed opacity-60">Not applied</span>{/if}
		{#if $interceptFlag}<span class="opacity-60">Intercept all is on</span>{/if}
		<button class="cp-update-rules btn btn-sm {primary}" on:click={onUpdate}>
			<SquarePlay size={14} class="mr-1" />Update rules
		</button>
	</div>
</div>
