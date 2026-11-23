<script>
	// The Marasi menu for a code editor's selected text: a right-click on
	// a selection in any CodeMirror editor (not the Ledger query editor)
	// opens it in place of the system's menu, with Copy and Send to
	// CyberChef's recipes (editorMenu.js), drawn by the Ledger's RowMenu.
	// The root layout mounts it on desktop; a phone or tablet has
	// SelectionChefButton instead. An editor inside a modal or drawer gets
	// the menu inside that overlay, since the overlay makes the rest of the
	// app inert. The menu sits in a non-modal dialog while it shows, so the
	// overlay isolation (overlayIsolation.js) takes it as the top overlay:
	// Escape cancels the dialog, which closes the menu, not the modal.
	import { onMount } from "svelte";
	import { getToastStore } from "@skeletonlabs/skeleton";
	import { EditorView } from "@codemirror/view";
	import RowMenu from "../ledger/RowMenu.svelte";
	import { editorMenuFor, selectionAt, selectionHeader } from "./editorMenu.js";
	import { recipes } from "./documents.js";
	import { sendTextToChef } from "./cyberchef/sendAction.js";
	import { chefShown } from "../platform.js";

	const toastStore = getToastStore();
	const OVERLAY = "dialog[open], .modal-backdrop, .drawer-backdrop";

	let menu = { open: false, x: 0, y: 0 };
	// The selection the menu acts on: { editor, view, text }.
	let selection = null;
	let host = null;

	$: items = menu.open ? editorMenuFor({ recipes: $recipes, chef: $chefShown }) : [];
	$: header = selection ? selectionHeader(selection.text) : null;

	function onContextMenu(event) {
		if (event.defaultPrevented) return;
		const found = selectionAt(event.target, (el) => EditorView.findFromDOM(el), document.getSelection());
		if (!found) return;
		event.preventDefault();
		selection = found;
		host = found.editor.closest(OVERLAY);
		menu = { open: true, x: event.clientX, y: event.clientY };
	}

	// Moves the menu into `target` (an overlay), or leaves it where it is.
	function portal(node, target) {
		const home = node.parentNode;
		const place = (to) => (to ?? home)?.appendChild(node);
		place(target);
		return {
			update: place,
			destroy: () => node.remove(),
		};
	}

	async function copy(text) {
		try {
			await navigator.clipboard.writeText(text);
			toastStore.trigger({ message: "Copied", background: "variant-filled-success", timeout: 1500 });
		} catch {
			toastStore.trigger({ message: "Failed to copy", background: "variant-filled-error" });
		}
	}

	function run(action) {
		const text = selection?.text;
		if (!text) return;
		if (action.type === "copy") copy(text);
		else if (action.type === "send-to-chef") sendTextToChef(text, toastStore, action.target);
	}

	// Shows the dialog by setting `open`, which the isolation watches for, and
	// closes it on the way out, so the isolation hands focus back.
	function asDialog(node) {
		node.show();
		const cancel = (event) => {
			event.preventDefault();
			menu = { ...menu, open: false };
		};
		node.addEventListener("cancel", cancel);
		return {
			destroy() {
				node.removeEventListener("cancel", cancel);
				if (node.open) node.close();
			},
		};
	}

	function onClose(event) {
		if (event.detail.refocus && selection?.view?.dom.isConnected) selection.view.focus();
	}

	onMount(() => {
		window.addEventListener("contextmenu", onContextMenu);
		return () => window.removeEventListener("contextmenu", onContextMenu);
	});
</script>

<div class="editor-selection-menu" use:portal={host}>
	{#if menu.open}
		<dialog use:asDialog class="editor-selection-dialog" aria-label="Selection actions">
			<RowMenu
				bind:open={menu.open}
				x={menu.x}
				y={menu.y}
				{items}
				label="Actions for the selection"
				extendHint={false}
				on:action={(event) => run(event.detail)}
				on:close={onClose}
			>
				<div slot="header" data-testid="editor-menu-header">
					<div class="font-semibold">Selection <span class="font-normal opacity-60">· {header?.size ?? ""}</span></div>
					{#if header?.preview}
						<div class="mt-0.5 truncate font-mono text-2xs opacity-70" title={header.preview}>{header.preview}</div>
					{/if}
				</div>
			</RowMenu>
		</dialog>
	{/if}
</div>

<style>
	/* The dialog only holds the menu, which places itself (fixed). */
	.editor-selection-dialog {
		position: fixed;
		inset: 0 auto auto 0;
		width: 0;
		height: 0;
		margin: 0;
		padding: 0;
		border: 0;
		overflow: visible;
		background: transparent;
		/* A dialog's own default is CanvasText, dark even in dark mode. */
		color: inherit;
		z-index: 1000;
	}
</style>
