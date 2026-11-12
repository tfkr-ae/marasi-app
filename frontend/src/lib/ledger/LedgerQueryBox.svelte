<script>
	// The Ledger's query box: a one-line CodeMirror editor. Suggestions come
	// from ledgerQueryEditor.js, fields, operators, keywords and quoted values
	// are coloured, and Marasi's query error is underlined at its position.
	// It reports edits ("change") and Enter ("run"); the page runs and
	// debounces queries. Escape, or a click outside it, leaves the box. A query
	// longer than the box shows an expand button that wraps it onto as many
	// lines as it needs.
	import { createEventDispatcher, onDestroy, onMount } from "svelte";
	import { Decoration, EditorView, keymap, placeholder } from "@codemirror/view";
	import { Compartment, EditorState, Prec, StateEffect, StateField } from "@codemirror/state";
	import { ChevronsDownUp, ChevronsUpDown } from "lucide-svelte";
	import { autocompletion, startCompletion } from "@codemirror/autocomplete";
	import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
	import { tags } from "@lezer/highlight";
	import { explicitCompletion, fieldNamed, queryErrorRange, querySuggestions } from "../ledgerQueryEditor";
	import { clearSelectionOnBlur } from "./leaveEditor.js";

	export let value = "";
	/** Marasi's error for `value`: { position (1-based), message }, or null. */
	export let error = null;
	/** Queries ({ label, query }) offered when the box is empty. */
	export let readyMade = [];
	/** The editable element's id, so focus shortcuts and recipes can reach it. */
	export let id = "searchBox";
	/** Whether the whole query shows, wrapped, rather than one line. */
	export let expanded = false;

	const dispatch = createEventDispatcher();
	let parent;
	let view;
	// True while the box takes the page's value, so that edit isn't reported back.
	let syncing = false;
	// True when the query runs past the box's one line.
	let overflowing = false;
	// CodeMirror opens suggestions under the caret; these move them so the
	// list hangs from the toolbar's bottom border (drop), and the ready-made
	// list fills the search area (inset, span): the box plus the Live
	// indicator, between the dock's border and the first menu's divider.
	let drop = 0;
	let inset = 0;
	let span = 0;
	const wrapping = new Compartment();

	function measureOverflow() {
		view?.requestMeasure({
			read: (v) => {
				const caret = v.coordsAtPos(v.state.selection.main.head);
				const bar = parent.closest(".ledger-toolbar")?.getBoundingClientRect();
				const area = parent.closest(".ledger-search")?.getBoundingClientRect();
				return {
					wide: v.scrollDOM.scrollWidth > v.scrollDOM.clientWidth + 1,
					drop: caret && bar ? bar.bottom - caret.bottom : 0,
					inset: caret && area ? area.left - caret.left : 0,
					span: area?.width ?? 0,
				};
			},
			write: (m) => {
				overflowing = m.wide;
				drop = m.drop;
				inset = m.inset;
				span = m.span;
			},
		});
	}

	// Collapsing keeps the button until a measure says one line holds the
	// query: wrapped, it read as fitting.
	function toggleExpanded() {
		if (expanded) overflowing = true;
		expanded = !expanded;
	}

	// A click anywhere else leaves the box, rows included (they keep focus
	// where it is so a drag doesn't select text).
	function onWindowPointerDown(event) {
		if (view && document.activeElement === view.contentDOM && parent && !parent.contains(event.target)) view.contentDOM.blur();
	}

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

	const explicit = explicitCompletion();

	// Opens the suggestions on request (focus on an empty box, Ctrl-Space).
	function requestCompletion(v) {
		explicit.request(v.state.selection.main.head);
		return startCompletion(v);
	}

	function completionSource(context) {
		const before = context.state.sliceDoc(0, context.pos);
		const result = querySuggestions(before, context.state.doc.length, explicit.at(context.explicit, context.pos), readyMade);
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

	// Underlines the word at Marasi's error position (see queryErrorRange).
	function errorDecorations(doc, err) {
		const range = queryErrorRange(doc, err);
		if (!range) return Decoration.none;
		return Decoration.set([
			Decoration.mark({ class: "ledger-query-error", attributes: { title: err.message } }).range(range.from, range.to),
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
					// Ahead of the suggestion keymap's own Ctrl-Space, so the
					// request is recorded as explicit (see explicitCompletion).
					Prec.highest(keymap.of([
						{ key: "Ctrl-Space", run: requestCompletion },
						{ mac: "Alt-`", run: requestCompletion },
					])),
					// Escape leaves the box, suggestions open or not (leaving
					// closes them), and stays with it, as it did with the input.
					// Ahead of the suggestion keymap, which would only close them.
					Prec.highest(
						EditorView.domEventHandlers({
							keydown: (event, v) => {
								if (event.key !== "Escape") return false;
								event.stopPropagation();
								v.contentDOM.blur();
								return true;
							},
						}),
					),
					autocompletion({
						override: [completionSource],
						icons: false,
						// The ready-made list belongs to the whole box, not the caret.
						tooltipClass: (state) => (state.doc.length ? "" : "ledger-query-ready"),
					}),
					wrapping.of([]),
					// One line only: line breaks from typing or pasting become spaces.
					EditorState.transactionFilter.of((tr) =>
						tr.docChanged && tr.newDoc.lines > 1
							? [tr, { changes: { from: 0, to: tr.newDoc.length, insert: tr.newDoc.toString().replace(/\n/g, " ") }, sequential: true }]
							: tr,
					),
					// After the suggestion keymap, so Enter acts on an open
					// suggestion list first.
					Prec.high(keymap.of([{ key: "Enter", run: () => (dispatch("run"), true) }])),
					clearSelectionOnBlur,
					EditorView.domEventHandlers({
						focus: (_event, v) => {
							if (!v.state.doc.length) setTimeout(() => requestCompletion(v));
						},
					}),
					EditorView.updateListener.of((update) => {
						if (update.docChanged && !syncing) dispatch("change", update.state.doc.toString());
						if (update.docChanged || update.selectionSet || update.geometryChanged) measureOverflow();
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
	$: if (view) {
		view.dispatch({ effects: wrapping.reconfigure(expanded ? EditorView.lineWrapping : []) });
		measureOverflow();
	}
</script>

<svelte:window on:pointerdown|capture={onWindowPointerDown} on:resize={measureOverflow} />

<!-- Expanded, the box keeps at least 3/5 of the row, so a long error beside
     it truncates instead of squeezing the query into a narrow column. -->
<div class="flex min-w-0 {expanded ? 'shrink-0 grow basis-3/5' : 'flex-1'} items-start gap-1">
	<div
		bind:this={parent}
		class="ledger-query min-w-0 flex-1 {expanded ? 'ledger-query-expanded' : ''}"
		style="--ledger-query-drop: {drop}px; --ledger-query-inset: {inset}px; --ledger-query-span: {span}px"
	></div>
	{#if overflowing || expanded}
		<button
			type="button"
			id="ledgerQueryExpand"
			class="ledger-query-line flex flex-none items-center px-0.5 opacity-60 hover:opacity-100"
			title={expanded ? "Back to one line" : "Show the whole query"}
			aria-label={expanded ? "Back to one line" : "Show the whole query"}
			aria-pressed={expanded}
			on:mousedown|preventDefault
			on:click={toggleExpanded}
			>{#if expanded}<ChevronsDownUp size={14} />{:else}<ChevronsUpDown size={14} />{/if}</button
		>
	{/if}
</div>

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
	/* The expand button is one query line tall, centred on the first line. */
	.ledger-query-line {
		height: 1.3125rem;
	}
	.ledger-query-expanded :global(.cm-scroller) {
		max-height: 30vh;
		overflow-y: auto;
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
	/* Suggestions hang from the toolbar's border, so they draw no top border
	   of their own. Field, operator and value labels start under the word
	   being typed (the item's 10px padding plus the 1px border). */
	.ledger-query :global(.cm-tooltip.cm-tooltip-autocomplete) {
		margin-top: var(--ledger-query-drop);
		margin-left: -11px;
		border-top-width: 0;
	}
	/* The ready-made list fills the search area; the dock's border and the
	   menu divider are its sides. */
	.ledger-query :global(.cm-tooltip.cm-tooltip-autocomplete.ledger-query-ready) {
		margin-left: var(--ledger-query-inset);
		width: var(--ledger-query-span);
		border-left-width: 0;
		border-right-width: 0;
	}
	.ledger-query :global(.cm-tooltip.cm-tooltip-autocomplete.ledger-query-ready > ul) {
		min-width: 0;
		max-width: none;
	}
	/* Its text starts in line with the search icon (the area's 12px inset). */
	.ledger-query :global(.cm-tooltip.cm-tooltip-autocomplete.ledger-query-ready > ul > li),
	.ledger-query :global(.cm-tooltip.cm-tooltip-autocomplete.ledger-query-ready > ul > completion-section) {
		padding-left: 12px;
		padding-right: 12px;
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
	/* The note beside the list shares the list's right border, and its top
	   border lies on the line above the chosen suggestion (the toolbar's
	   border for the first). */
	.ledger-query :global(.cm-tooltip.cm-completionInfo) {
		margin-top: -1px;
		padding: 6px 10px;
		max-width: 22rem;
		font-family: system-ui;
		font-size: 0.75rem;
		white-space: pre-line;
	}
</style>
