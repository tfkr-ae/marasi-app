<script>
	// Compare mode for the open launchpad: the picking banner, the A/B chip
	// strip with swap and length summary, and a read-only CodeMirror
	// MergeView of A against B. Rules live in compare.js; this only renders.
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import { MergeView } from "@codemirror/merge";
	import { StreamLanguage } from "@codemirror/language";
	import { http } from "@codemirror/legacy-modes/mode/http";
	import { EditorState } from "@codemirror/state";
	import { EditorView } from "@codemirror/view";
	import { oneDark } from "@codemirror/theme-one-dark";
	import { githubLight } from "@uiw/codemirror-theme-github";
	import { ArrowLeftRight, GitCompare } from "lucide-svelte";
	import { lineWrap, marasiConfig } from "../../stores";
	import { wrapsLines } from "../lineWrap.js";
	import { changedLineCount, COMPARE_SIDES, compareView, lengthSummary } from "./compare.js";
	import { primaryVariant, statusClass } from "./format.js";

	export let store;

	let tab = "response";
	/** Flips the diff between the Request and Response tabs. */
	export function toggleTab() {
		tab = tab === "response" ? "request" : "response";
	}

	$: state = $store;
	$: view = compareView(state);
	// Each compare opens on the Response tab.
	$: if (!view) tab = "response";
	$: primary = primaryVariant($modeCurrent);
	$: leftDetails = view?.left && state.detailsById[view.left.entry.ID];
	$: rightDetails = view?.right && state.detailsById[view.right.entry.ID];
	$: part = tab === "response" ? "Response" : "Request";
	$: lengths = lengthSummary(leftDetails, rightDetails, tab);
	$: note =
		!leftDetails || !rightDetails
			? "Loading…"
			: tab === "response" && (!leftDetails.Response || !rightDetails.Response)
				? "One side has no response yet."
				: "";
	$: leftText = leftDetails?.[part]?.Raw ?? "";
	$: rightText = rightDetails?.[part]?.Raw ?? "";
	$: merge = {
		leftId: view?.left?.entry.ID,
		rightId: view?.right?.entry.ID,
		part,
		a: leftText,
		b: rightText,
		light: $modeCurrent,
		wrap: wrapsLines(leftText, $lineWrap, $marasiConfig.WrapMode) && wrapsLines(rightText, $lineWrap, $marasiConfig.WrapMode),
	};

	let changes = 0;
	let approximate = false;

	// Builds the MergeView into `node`, and rebuilds it whenever A, B, the
	// view, their texts, the theme or wrapping change; destroyed with the node.
	const MERGE_KEYS = ["leftId", "rightId", "part", "a", "b", "light", "wrap"];
	function mergeView(node, config) {
		let current;
		let editor;
		const build = (next) => {
			editor?.destroy();
			current = next;
			const side = (doc) => ({
				doc,
				extensions: [
					EditorState.readOnly.of(true),
					EditorView.editable.of(false),
					next.light ? githubLight : oneDark,
					StreamLanguage.define(http),
					next.wrap ? EditorView.lineWrapping : [],
				],
			});
			editor = new MergeView({
				parent: node,
				a: side(next.a),
				b: side(next.b),
				collapseUnchanged: { margin: 3, minSize: 4 },
			});
			changes = changedLineCount(editor.chunks, next.a, next.b);
			approximate = editor.chunks.some((chunk) => !chunk.precise);
		};
		build(config);
		return {
			update(next) {
				if (MERGE_KEYS.some((key) => next[key] !== current[key])) build(next);
			},
			destroy: () => editor?.destroy(),
		};
	}

	const chips = (v) => [
		["left", COMPARE_SIDES.left.label, v.left, "variant-filled-tertiary"],
		["right", COMPARE_SIDES.right.label, v.right, primary],
	];
</script>

{#if view}
	{#if view.picking}
		<div
			class="lp-compare-banner flex flex-wrap items-center gap-3 border-b border-l-4 border-surface-500/30 border-l-primary-500 bg-surface-100 px-3 py-2 text-xs dark:bg-surface-800"
		>
			<GitCompare size={14} />
			{#if view.picking === "right" && !view.right}
				<span>
					Comparing <span class="variant-filled-tertiary px-1.5 font-mono">A #{view.left?.number}</span>
					with… <b>click any entry in the sidebar</b>
				</span>
				{#if view.quickPicks.length}<span class="opacity-60">or</span>{/if}
				{#each view.quickPicks as pick}
					<button class="btn btn-sm {primary} py-0.5" on:click={() => store.setCompareSide("right", pick.id)}
						>{pick.label}</button
					>
				{/each}
			{:else}
				<span><b>Click an entry in the sidebar</b> to use as the new {COMPARE_SIDES[view.picking].label}.</span>
			{/if}
			<span class="ml-auto opacity-60">Esc to cancel</span>
		</div>
	{/if}

	{#if view.comparing}
		<div class="lp-compare-strip flex flex-wrap items-center gap-2 border-b border-surface-500/30 bg-surface-100 px-3 py-2 text-xs dark:bg-surface-800">
			{#each chips(view) as [side, letter, item, chipClass], i}
				{#if i === 1}
					<button
						class="btn btn-sm variant-soft self-stretch px-2"
						title="Swap A and B"
						aria-label="Swap A and B"
						on:click={store.swapCompare}
					>
						<ArrowLeftRight size={14} />
					</button>
				{/if}
				<button
					class="lp-chip flex min-w-0 items-center gap-2 border px-2 py-1 font-mono transition-colors {view.picking === side
						? 'border-primary-500 bg-primary-500/10'
						: 'border-surface-500/30 hover:border-primary-500'}"
					title="Click, then pick another entry for {letter}"
					aria-pressed={view.picking === side}
					data-side={side}
					on:click={() => store.pickCompareSide(view.picking === side ? null : side)}
				>
					<span class="{chipClass} px-1.5 text-[11px] font-bold">{letter}</span>
					<span>#{item.number}</span>
					<span class="truncate opacity-60">{item.entry.Method} {item.entry.Path}</span>
					<span class={statusClass(item.entry.StatusCode)}>{item.entry.StatusCode || "…"}</span>
				</button>
			{/each}
			<span class="lp-length ml-2 whitespace-nowrap">
				Length {lengths.left ?? "…"} → {lengths.right ?? "…"}
				{#if lengths.delta !== null}
					<span class={lengths.delta === 0 ? "opacity-50" : lengths.delta > 0 ? "text-success-500" : "text-error-500"}>
						({lengths.delta > 0 ? "+" : ""}{lengths.delta})
					</span>
				{/if}
			</span>
			<span class="whitespace-nowrap opacity-60">· {changes} changed {changes === 1 ? "line" : "lines"}</span>
			<div class="ml-auto flex">
				{#each ["request", "response"] as name}
					<button
						class="btn btn-sm capitalize {tab === name ? primary : 'variant-soft'}"
						aria-pressed={tab === name}
						on:click={() => (tab = name)}>{name}</button
					>
				{/each}
			</div>
		</div>
		{#if approximate}
			<p class="border-b border-surface-500/30 bg-warning-500/10 px-3 py-1 text-xs">
				These bodies differ too much to align line by line; the differing middle is shown as one block.
			</p>
		{/if}
		<div class="lp-diff lp-scroll min-h-0 flex-1 overflow-auto text-xs dark:bg-[#282c34]">
			{#if note}<p class="p-4 font-sans text-sm opacity-60">{note}</p>{/if}
			<div use:mergeView={merge} />
		</div>
	{/if}
{/if}
