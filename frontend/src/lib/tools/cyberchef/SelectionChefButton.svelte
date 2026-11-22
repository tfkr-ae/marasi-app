<script>
	// Send to CyberChef for a touch selection: iOS's and Android's text
	// callout can't take the app's items, so a selection in an editor (not
	// the Ledger query editor) gets this button at the bottom of the visible
	// screen, above the keyboard: next to the selection, the callout (above
	// or below it) can cover it. The root layout mounts it on mobile where
	// the app offers CyberChef.
	import { onMount } from "svelte";
	import { getToastStore, modeCurrent } from "@skeletonlabs/skeleton";
	import { EditorView } from "@codemirror/view";
	import { CookingPot } from "lucide-svelte";
	import { sendTextToChef } from "./sendAction.js";
	import { primaryVariant } from "../../launchpad/format.js";

	const toastStore = getToastStore();
	// Room between the button and the bottom of the visible screen.
	const MARGIN = 16;

	let shown = null; // { text, bottom }
	$: primary = primaryVariant($modeCurrent);

	// The editor's selection, or the page's when the editor tracks none (an
	// editor that isn't editable leaves its selection to the page).
	function selected(selection) {
		if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
		const node = selection.anchorNode;
		const editor = (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.(".cm-editor");
		if (!editor || editor.closest(".ledger-query")) return null;
		const view = EditorView.findFromDOM(editor);
		const main = view?.state.selection.main;
		const text = main && !main.empty ? view.state.sliceDoc(main.from, main.to) : selection.toString();
		if (!text) return null;
		return text;
	}

	function place() {
		const text = selected(document.getSelection());
		if (!text) {
			shown = null;
			return;
		}
		// The keyboard shrinks the visual viewport, not the layout one.
		const view = window.visualViewport;
		const visibleBottom = view ? view.offsetTop + view.height : window.innerHeight;
		shown = { text, bottom: Math.max(0, window.innerHeight - visibleBottom) + MARGIN };
	}

	// CodeMirror updates its selection on the same selectionchange, so the
	// read waits a frame.
	let frame = 0;
	function schedule() {
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(place);
	}

	function send(event) {
		event.preventDefault();
		if (!shown) return;
		const { text } = shown;
		shown = null;
		document.getSelection()?.removeAllRanges();
		sendTextToChef(text, toastStore);
	}

	onMount(() => {
		document.addEventListener("selectionchange", schedule);
		window.addEventListener("scroll", schedule, true);
		window.addEventListener("resize", schedule);
		window.visualViewport?.addEventListener("resize", schedule);
		return () => {
			window.visualViewport?.removeEventListener("resize", schedule);
			cancelAnimationFrame(frame);
			document.removeEventListener("selectionchange", schedule);
			window.removeEventListener("scroll", schedule, true);
			window.removeEventListener("resize", schedule);
		};
	});
</script>

<!-- A touch's own end sends, and cancels the click after it, so the tap
     neither moves focus nor clears the selection first. The backing keeps
     a ghost button legible over the editor's text. -->
<div
	class="selection-chef fixed left-1/2 z-[60] -translate-x-1/2 bg-surface-50-900-token shadow-lg"
	class:hidden={!shown}
	style:bottom="{shown?.bottom ?? 0}px"
>
	<button
		type="button"
		class="btn btn-sm {primary} gap-1 text-xs"
		data-testid="selection-send-to-chef"
		on:mousedown|preventDefault
		on:touchend={send}
		on:click={send}
	>
		<CookingPot size={14} />
		Send to CyberChef
	</button>
</div>
