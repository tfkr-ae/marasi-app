<script>
	// The Excalidraw page: the open project's Drawings as tabs over the
	// canvas. Drawings live in toolDocuments (lib/tools/documents.js), so
	// they stay when the page unmounts.
	import { getModalStore } from "@skeletonlabs/skeleton";
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import { Copy, FilePlus, Keyboard, Paperclip, PanelRight, Pencil, Replace, Trash2 } from "lucide-svelte";
	import MarasiMenu from "../../lib/components/MarasiMenu/MarasiMenu.svelte";
	import { useMenuActions } from "../../lib/keybindings/app.js";
	import DocumentTabs from "../../lib/tools/DocumentTabs.svelte";
	import ExcalidrawIsland from "../../lib/tools/ExcalidrawIsland.svelte";
	import { drawings } from "../../lib/tools/documents.js";
	import { deleteDocument, renameDocument, switchDocument } from "../../lib/tools/documentPrompts.js";
	import { drawingKind } from "../../lib/tools/toolDocuments.js";
	import { neutralVariant } from "../../lib/launchpad/format.js";

	const modalStore = getModalStore();
	let island;

	$: current = $drawings.items.find((d) => d.id === $drawings.openId) ?? $drawings.items[0];

	const rename = (id) => renameDocument(modalStore, drawings, id, "drawing");
	const remove = (id) => deleteDocument(modalStore, drawings, id, "drawing", drawingKind.isEmpty);

	// Insert and Attach… arrive with their panels (issue 02).
	const menu = [
		{ actionId: "excalidraw.new-drawing", icon: FilePlus, handler: () => drawings.create() },
		{
			actionId: "excalidraw.switch-drawing",
			icon: Replace,
			handler: () => switchDocument(modalStore, drawings, "drawing", "excalidraw.switch-drawing"),
		},
		{ actionId: "excalidraw.rename-drawing", icon: Pencil, handler: () => rename(current.id) },
		{ actionId: "excalidraw.duplicate-drawing", icon: Copy, handler: () => drawings.duplicate(current.id) },
		{ actionId: "excalidraw.delete-drawing", icon: Trash2, handler: () => remove(current.id) },
		{ actionId: "excalidraw.insert", icon: PanelRight, handler: () => {} },
		{ actionId: "excalidraw.attach", icon: Paperclip, handler: () => {} },
		{ actionId: "excalidraw.shortcuts", icon: Keyboard, handler: () => island?.openHelp() },
	];
	useMenuActions(menu);
</script>

<MarasiMenu paletteTier="page" pageName="Excalidraw" pageEntries={menu} />

<div class="flex h-full min-h-0 flex-col" data-testid="excalidraw-page">
	<DocumentTabs documents={drawings} noun="drawing" onRename={rename} onDelete={remove}>
		<button type="button" class="btn btn-sm {neutralVariant($modeCurrent)}" disabled>Insert</button>
		<button type="button" class="btn btn-sm {neutralVariant($modeCurrent)}" disabled>Attach…</button>
	</DocumentTabs>
	<div class="relative min-h-0 flex-1">
		{#key current.id}
			<ExcalidrawIsland
				bind:this={island}
				drawing={current}
				dark={!$modeCurrent}
				onChange={drawings.change}
			/>
		{/key}
	</div>
</div>
