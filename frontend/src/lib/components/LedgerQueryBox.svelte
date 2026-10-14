<script>
	// The Ledger's query box: a one-line CodeMirror editor. Suggestions come
	// from ledgerQueryEditor.js, fields, operators, keywords and quoted values
	// are coloured, and Marasi's query error is underlined at its position.
	// It reports edits ("change"), Enter ("run") and Escape ("clear"); the
	// page runs and debounces queries.
	import { createEventDispatcher, onDestroy, onMount } from "svelte";
	import { Decoration, EditorView, keymap, placeholder } from "@codemirror/view";
	import { EditorState, Prec, StateEffect, StateField } from "@codemirror/state";
	import { autocompletion, completionStatus, startCompletion } from "@codemirror/autocomplete";
	import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
	import { tags } from "@lezer/highlight";
	import { fieldNamed, querySuggestions } from "../ledgerQueryEditor";

	export let value = "";
	/** Marasi's error for `value`: { position (1-based), message }, or null. */
	export let error = null;
	/** The editable element's id, so focus shortcuts and recipes can reach it. */
	export let id = "searchBox";

	const dispatch = createEventDispatcher();
	let parent;
	let view;
	// True while the box takes the page's value, so that edit isn't reported back.
	let syncing = false;

	const queryLanguage = StreamLanguage.define({
		token(stream) {
			if (stream.eatSpace()) return null;
			if (stream.match(/"(?:[^"\\]|\\.)*"?/)) return "string";
			if (stream.match(/!=|>=|<=|=|>|<|:/)) return "operator";
			if (stream.match(/[()]/)) return "paren";
			if (stream.match(/-(?=[^\s-])/)) return "operator";
			if (stream.match(/\d+(?=[\s)]|$)/)) return "number";
			const word = stream.match(/[^\s()"=!<>:]+/);
			if (!word) {
				stream.next();
				return null;
			}
			if (/^(AND|OR|NOT)$/.test(word[0])) return "keyword";
			if (fieldNamed(word[0])) return "propertyName";
			return word[0] === "*" ? "operator" : null;
		},
	});

	const highlight = HighlightStyle.define([
		{ tag: tags.propertyName, color: "var(--ledger-query-field)", fontWeight: "600" },
		{ tag: [tags.operator, tags.paren], color: "var(--ledger-query-operator)" },
		{ tag: tags.keyword, fontWeight: "700" },
		{ tag: tags.string, color: "var(--ledger-query-string)" },
		{ tag: tags.number, color: "var(--ledger-query-number)" },
	]);

	// Inserts the chosen text and, for a field or operator, opens the next
	// suggestions (operators after a field, the example value after one).
	function applyOption(option) {
		return (v, _completion, from, to) => {
			v.dispatch({
				changes: { from, to, insert: option.insert },
				selection: { anchor: from + option.insert.length },
			});
			if (option.next) setTimeout(() => startCompletion(v));
		};
	}

	function completionSource(context) {
		const before = context.state.sliceDoc(0, context.pos);
		const result = querySuggestions(before, context.state.doc.length, context.explicit);
		if (!result) return null;
		return {
			from: result.from,
			to: result.to,
			filter: false,
			options: result.options.map((o) => ({
				label: o.kind === "query" ? o.insert : o.label,
				displayLabel: o.label,
				detail: o.detail,
				info: o.info,
				section: o.section,
				type: o.kind,
				apply: applyOption(o),
			})),
		};
	}

	const setError = StateEffect.define();
	const errorField = StateField.define({
		create: () => Decoration.none,
		update(decorations, tr) {
			decorations = decorations.map(tr.changes);
			for (const effect of tr.effects) {
				if (effect.is(setError)) decorations = effect.value;
			}
			return decorations;
		},
		provide: (field) => EditorView.decorations.from(field),
	});

	// Underlines the word at Marasi's 1-based position, or the rest of the
	// query when the position is at its end. Marasi counts characters (code
	// points); CodeMirror offsets count UTF-16 units.
	function errorDecorations(doc, err) {
		if (!err?.position) return Decoration.none;
		const from = Array.from(doc).slice(0, Math.max(err.position - 1, 0)).join("").length;
		const word = doc.slice(from).match(/^[^\s()]+/)?.[0];
		const to = word ? from + word.length : doc.length;
		if (to <= from) return Decoration.none;
		return Decoration.set([
			Decoration.mark({ class: "ledger-query-error", attributes: { title: err.message } }).range(from, to),
		]);
	}

	onMount(() => {
		view = new EditorView({
			parent,
			state: EditorState.create({
				doc: value,
				extensions: [
					queryLanguage,
					syntaxHighlighting(highlight),
					errorField,
					placeholder("Search traffic…"),
					EditorView.contentAttributes.of({ id, "aria-label": "Query", spellcheck: "false", autocorrect: "off", autocapitalize: "off" }),
					autocompletion({ override: [completionSource], icons: false }),
					// One line only: line breaks from typing or pasting become spaces.
					EditorState.transactionFilter.of((tr) =>
						tr.docChanged && tr.newDoc.lines > 1
							? [tr, { changes: { from: 0, to: tr.newDoc.length, insert: tr.newDoc.toString().replace(/\n/g, " ") }, sequential: true }]
							: tr,
					),
					// After the suggestion keymap, so Enter and Escape act on
					// an open suggestion list first.
					Prec.high(
						keymap.of([
							{ key: "Enter", run: () => (dispatch("run"), true) },
							{ key: "Escape", run: (v) => (completionStatus(v.state) ? false : (dispatch("clear"), true)) },
						]),
					),
					EditorView.domEventHandlers({
						// Escape stays with the query box, as it did with the input.
						keydown: (event) => {
							if (event.key === "Escape") event.stopPropagation();
							return false;
						},
						focus: (_event, v) => {
							if (!v.state.doc.length) setTimeout(() => startCompletion(v));
						},
					}),
					EditorView.updateListener.of((update) => {
						if (update.docChanged && !syncing) dispatch("change", update.state.doc.toString());
					}),
				],
			}),
		});
	});

	onDestroy(() => view?.destroy());

	// Follow the page's query text when it changes from outside: clearing,
	// inserting an example, restoring the query after navigation.
	$: if (view && value !== view.state.doc.toString()) {
		syncing = true;
		view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value }, selection: { anchor: value.length } });
		syncing = false;
	}
	$: if (view) view.dispatch({ effects: setError.of(errorDecorations(view.state.doc.toString(), error)) });
</script>

<div bind:this={parent} class="ledger-query min-w-0 flex-1"></div>

<style>
	.ledger-query {
		--ledger-query-field: rgb(var(--color-primary-600));
		--ledger-query-operator: rgb(var(--color-surface-400));
		--ledger-query-string: rgb(var(--color-success-700));
		--ledger-query-number: rgb(var(--color-tertiary-700));
	}
	:global(.dark) .ledger-query {
		--ledger-query-field: rgb(var(--color-primary-400));
		--ledger-query-operator: rgb(var(--color-surface-300));
		--ledger-query-string: rgb(var(--color-success-400));
		--ledger-query-number: rgb(var(--color-tertiary-400));
	}
	.ledger-query :global(.cm-editor) {
		background: transparent;
		font-size: 0.875rem;
	}
	.ledger-query :global(.cm-editor.cm-focused) {
		outline: none;
	}
	.ledger-query :global(.cm-scroller) {
		font-family: var(--theme-font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
		overflow: hidden;
		line-height: 1.5;
	}
	.ledger-query :global(.cm-content) {
		padding: 0;
		caret-color: currentColor;
	}
	.ledger-query :global(.cm-line) {
		padding: 0;
	}
	.ledger-query :global(.cm-placeholder) {
		color: inherit;
		opacity: 0.5;
	}
	.ledger-query :global(.ledger-query-error) {
		text-decoration: underline wavy rgb(var(--color-error-500));
		text-underline-offset: 3px;
	}
	/* Suggestions: the toolbar's surface, square, primary for the selection. */
	.ledger-query :global(.cm-tooltip) {
		border: 1px solid rgb(var(--color-surface-300));
		background: rgb(var(--color-surface-100));
		border-radius: 0;
		box-shadow: 0 10px 25px rgb(0 0 0 / 0.18);
		color: rgb(var(--color-surface-900));
	}
	:global(.dark) .ledger-query :global(.cm-tooltip) {
		border-color: rgb(var(--color-surface-600));
		background: rgb(var(--color-surface-800));
		color: rgb(var(--color-surface-50));
	}
	.ledger-query :global(.cm-tooltip.cm-tooltip-autocomplete > ul) {
		font-family: var(--theme-font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
		font-size: 0.75rem;
		max-height: 18rem;
		min-width: 22rem;
		scrollbar-width: thin;
	}
	.ledger-query :global(.cm-tooltip.cm-tooltip-autocomplete > ul > li) {
		padding: 4px 10px;
		line-height: 1.4;
	}
	.ledger-query :global(.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]) {
		background: rgb(var(--color-primary-500) / 0.22);
		color: inherit;
	}
	.ledger-query :global(.cm-tooltip.cm-tooltip-autocomplete > ul > completion-section) {
		padding: 4px 10px;
		font-family: system-ui;
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		opacity: 0.6;
		border-bottom: 1px solid rgb(var(--color-surface-500) / 0.3);
	}
	.ledger-query :global(.cm-completionLabel) {
		font-weight: 600;
	}
	.ledger-query :global(.cm-completionDetail) {
		font-style: normal;
		opacity: 0.6;
		margin-left: 1.2em;
	}
	.ledger-query :global(.cm-tooltip.cm-completionInfo) {
		padding: 6px 10px;
		max-width: 22rem;
		font-family: system-ui;
		font-size: 0.75rem;
		white-space: pre-line;
	}
</style>
