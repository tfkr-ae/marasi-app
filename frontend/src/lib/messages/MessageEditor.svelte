<script>
	// An editor for a message's text: the protobuf text form (language
	// "protobuf"), JSON ("json") or UTF-8 text (null). `marker` ({ line,
	// column }, 1-based, the column in UTF-8 bytes as Marasi names a text
	// error) marks that line and place; set it to null to clear it. Used by
	// the streamed pair's Inject tab; reusable wherever a stream message is
	// edited.
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import CodeMirror from "svelte-codemirror-editor";
	import { vim } from "@replit/codemirror-vim";
	import { oneDark } from "@codemirror/theme-one-dark";
	import { githubLight } from "@uiw/codemirror-theme-github";
	import { marasiConfig, lineWrap } from "../../stores";
	import { longStrings } from "../longStrings.js";
	import { languageExtensions } from "./protobufText.js";
	import { errorMarker } from "./messageEditor.js";

	export let value = "";
	export let language = null;
	export let marker = null;
	export let readonly = false;

	$: extensions = [
		...($marasiConfig.VimEnabled ? [vim()] : []),
		longStrings({ wrap: $lineWrap, mode: $marasiConfig.WrapMode }),
		...languageExtensions(language),
		...errorMarker(marker),
	];
</script>

<CodeMirror
	class="h-full w-full text-xs"
	bind:value
	{readonly}
	theme={$modeCurrent ? githubLight : oneDark}
	{extensions}
/>
