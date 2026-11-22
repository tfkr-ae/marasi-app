<script>
	// An editor for one message's text: a held stream message (protobuf text
	// form, JSON, or UTF-8 text), a trailer block's "name: value" lines, or
	// read-only hex. It marks the line and column of a text error Marasi
	// named. Used by the Checkpoint page and the Messages modal's Inject tab,
	// and meant for its Checkpoint tab too; it knows nothing of any of them.
	import CodeMirror from "svelte-codemirror-editor";
	import { Decoration, EditorView } from "@codemirror/view";
	import { oneDark } from "@codemirror/theme-one-dark";
	import { githubLight } from "@uiw/codemirror-theme-github";
	import { vim } from "@replit/codemirror-vim";
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import { createEventDispatcher } from "svelte";
	import { lineWrap, marasiConfig } from "../../stores";
	import { longStrings } from "../longStrings.js";
	import { languageExtensions } from "./protobufText.js";
	import { markerOffset } from "./messageEditor.js";

	/** The text shown. */
	export let value = "";
	/** "protobuf", "json" or null. */
	export let language = null;
	export let readonly = false;
	/**
	 * { line, column }, 1-based with the column in UTF-8 bytes as Marasi
	 * counts it, to mark; null or line 0 for none.
	 */
	export let errorAt = null;
	/** Set while long lines aren't wrapped (see longStrings.js). */
	export let wrapSuspended = false;

	const dispatch = createEventDispatcher();
	let view;

	/** Focuses the editor. */
	export function focus() {
		view?.focus();
	}

	const errorTheme = EditorView.baseTheme({
		".cm-message-error-line": { backgroundColor: "rgb(var(--color-error-500) / 0.12)" },
		".cm-message-error": {
			textDecoration: "underline wavy rgb(var(--color-error-500))",
			textUnderlineOffset: "3px",
		},
	});

	// The error's line, and the character at its column (or the line's end).
	function errorMark(at) {
		if (!at?.line) return [];
		return [
			errorTheme,
			EditorView.decorations.compute(["doc"], (state) => {
				if (at.line > state.doc.lines) return Decoration.none;
				const line = state.doc.line(at.line);
				const from = line.from + markerOffset(line.text, 1, at.column || 1);
				const ranges = [Decoration.line({ class: "cm-message-error-line" }).range(line.from)];
				if (from < line.to) ranges.push(Decoration.mark({ class: "cm-message-error" }).range(from, from + 1));
				return Decoration.set(ranges, true);
			}),
		];
	}

	$: theme = $modeCurrent ? githubLight : oneDark;
	$: extensions = [
		...($marasiConfig.VimEnabled && !readonly ? [vim()] : []),
		...languageExtensions(language),
		longStrings({ wrap: $lineWrap, mode: $marasiConfig.WrapMode, onSuspend: (on) => (wrapSuspended = on) }),
		...errorMark(errorAt),
	];
</script>

<CodeMirror
	{value}
	nodebounce
	{readonly}
	editable={!readonly}
	on:change={(event) => dispatch("change", event.detail)}
	on:ready={(event) => (view = event.detail)}
	class="text-xs {readonly ? 'opacity-80' : ''}"
	styles={{ "&": { fontSize: "0.6875rem" } }}
	{theme}
	{extensions}
/>
