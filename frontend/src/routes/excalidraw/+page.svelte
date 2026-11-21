<script>
	// The Excalidraw page: the open project's Drawings as tabs over the
	// canvas, the Insert panel on the right, and Attach…. Drawings live in
	// toolDocuments (lib/tools/documents.js), so they stay when the page
	// unmounts. Cards are drawn by CardView over the canvas (cardEmbed.js,
	// cards.js).
	import { onDestroy } from "svelte";
	import { goto } from "$app/navigation";
	import { getModalStore, modeCurrent } from "@skeletonlabs/skeleton";
	import { Copy, FilePlus, Keyboard, Paperclip, PanelRight, Pencil, Replace, Trash2 } from "lucide-svelte";
	import MarasiMenu from "../../lib/components/MarasiMenu/MarasiMenu.svelte";
	import { useMenuActions } from "../../lib/keybindings/app.js";
	import DocumentTabs from "../../lib/tools/DocumentTabs.svelte";
	import ExcalidrawIsland from "../../lib/tools/ExcalidrawIsland.svelte";
	import InsertPanel from "../../lib/tools/InsertPanel.svelte";
	import AttachDialog from "../../lib/tools/AttachDialog.svelte";
	import { createCardEmbed } from "../../lib/tools/cardEmbed.js";
	import { drawingCards, drawings, setCanvasSize } from "../../lib/tools/documents.js";
	import { deleteDocument, renameDocument, switchDocument } from "../../lib/tools/documentPrompts.js";
	import { drawingKind } from "../../lib/tools/toolDocuments.js";
	import { DRAG_TYPE, cardSource, newCardElement, placeCard, sourceOfLink } from "../../lib/tools/cards.js";
	import { sceneView } from "../../lib/tools/drawingCards.js";
	import { DRAWING_FORMATS, drawingFile } from "../../lib/tools/drawingFile.js";
	import { pairRows } from "../../lib/tools/toolItems.js";
	import { neutralVariant, primaryVariant } from "../../lib/launchpad/format.js";
	import { logbookStore } from "../../stores/logbookStore.js";
	import { ledgerStore } from "../../stores/ledgerStore.js";

	const modalStore = getModalStore();
	let island;
	let host;
	let api = null;
	let lib = null;
	let showInsert = false;
	let stopApiChange = null;
	let stopTracking = () => {};
	let trackedKey = "";

	$: current = $drawings.items.find((d) => d.id === $drawings.openId) ?? $drawings.items[0];
	// A new drawing gets a fresh Excalidraw.
	$: if (current) resetApi(current.id);
	let apiDrawing = null;
	function resetApi(id) {
		if (apiDrawing === id) return;
		apiDrawing = id;
		api = null;
		stopApiChange?.();
		stopApiChange = null;
	}

	const rename = (id) => renameDocument(modalStore, drawings, id, "drawing");
	const remove = (id) => deleteDocument(modalStore, drawings, id, "drawing", drawingKind.isEmpty);

	function canvasSize() {
		const box = host?.getBoundingClientRect();
		return box ? { width: box.width, height: box.height } : null;
	}

	function onReady(readyApi, readyLib) {
		api = readyApi;
		lib = readyLib;
		stopApiChange?.();
		stopApiChange = api.onChange((elements, appState) => {
			cards.noteChange(appState);
			trackPairs(elements);
		});
		trackPairs(api.getSceneElements());
	}

	// Keeps the rows of the pairs on this drawing live.
	function trackPairs(elements) {
		const ids = elements
			.map(cardSource)
			.filter((source) => source?.kind === "pair")
			.map((source) => String(source.id))
			.sort();
		const key = ids.join(",");
		if (key === trackedKey) return;
		trackedKey = key;
		const previous = stopTracking;
		stopTracking = pairRows.track(ids);
		previous();
	}

	/** Adds a card for `source` (with a pair's `last` row), centred on `drop` when dropped. */
	function addCard(source, last = null, drop = null) {
		if (!api || !lib) return;
		const size = canvasSize();
		if (size) setCanvasSize(size);
		const elements = api.getSceneElementsIncludingDeleted();
		const at = placeCard({
			elements,
			view: sceneView(api.getAppState(), size ?? { width: 1200, height: 800 }),
			lastId: drawingCards.lastCardId(current.id),
			drop,
		});
		const [element] = lib.restoreElements([newCardElement(source, at, { last })], null);
		drawingCards.noteAdded(current.id, element.id);
		api.updateScene({ elements: [...elements, element], captureUpdate: lib.CaptureUpdateAction.IMMEDIATELY });
	}

	// Open ↗: the pair in the Ledger, or the record in the Logbook.
	async function openSource(source, last) {
		if (source.kind === "pair") {
			const number = $pairRows[String(source.id)]?.Number ?? last?.Number;
			await goto("/ledger");
			if (number != null) ledgerStore.goToNumber(number);
			return;
		}
		logbookStore.open(source.kind, source.id);
		goto("/logbook");
	}

	// Cards over the canvas (cardEmbed.js).
	const cards = createCardEmbed({ excalidraw: () => (api && lib ? { api, lib } : null), onOpen: openSource });
	const { embed } = cards;

	function onDragOver(event) {
		if (event.dataTransfer?.types?.includes(DRAG_TYPE)) {
			event.preventDefault();
			event.dataTransfer.dropEffect = "copy";
		}
	}

	function onDrop(event) {
		const raw = event.dataTransfer?.getData(DRAG_TYPE);
		if (!raw || !api) return;
		event.preventDefault();
		event.stopPropagation();
		const { source, last } = JSON.parse(raw);
		const point = lib.viewportCoordsToSceneCoords({ clientX: event.clientX, clientY: event.clientY }, api.getAppState());
		addCard(source, last, point);
	}

	function openAttach() {
		if (!api || !lib) return;
		const drawing = current;
		const [readyApi, readyLib] = [api, lib];
		modalStore.trigger({
			type: "component",
			component: {
				ref: AttachDialog,
				props: {
					documents: drawings,
					docId: drawing.id,
					noun: "drawing",
					formats: DRAWING_FORMATS,
					makeFile: (format) => drawingFile(readyLib, readyApi, drawing.name, format),
				},
			},
			toggleAction: "excalidraw.attach",
		});
	}

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
		{ actionId: "excalidraw.insert", icon: PanelRight, handler: () => (showInsert = !showInsert) },
		{ actionId: "excalidraw.attach", icon: Paperclip, handler: openAttach },
		{ actionId: "excalidraw.shortcuts", icon: Keyboard, handler: () => island?.openHelp() },
	];
	useMenuActions(menu);

	onDestroy(() => {
		const size = canvasSize();
		if (size) setCanvasSize(size);
		stopApiChange?.();
		stopTracking();
	});
</script>

<MarasiMenu paletteTier="page" pageName="Excalidraw" pageEntries={menu} />

<div class="flex h-full min-h-0 flex-col" data-testid="excalidraw-page">
	<DocumentTabs documents={drawings} noun="drawing" onRename={rename} onDelete={remove}>
		<button
			type="button"
			class="btn btn-sm {showInsert ? primaryVariant($modeCurrent) : neutralVariant($modeCurrent)}"
			aria-pressed={showInsert}
			data-testid="excalidraw-insert"
			on:click={() => (showInsert = !showInsert)}>Insert</button
		>
		<button
			type="button"
			class="btn btn-sm {neutralVariant($modeCurrent)}"
			data-testid="excalidraw-attach"
			disabled={!api}
			on:click={openAttach}>Attach…</button
		>
	</DocumentTabs>
	<div class="flex min-h-0 flex-1">
		<!-- svelte-ignore a11y-no-static-element-interactions -->
		<div class="relative min-w-0 flex-1" bind:this={host} on:dragover|capture={onDragOver} on:drop|capture={onDrop}>
			{#key current.id}
				<ExcalidrawIsland
					bind:this={island}
					drawing={current}
					dark={!$modeCurrent}
					onChange={drawings.change}
					{onReady}
					{embed}
					onOpenLink={(link) => {
						const source = sourceOfLink(link);
						if (source) openSource(source, null);
					}}
				/>
			{/key}
		</div>
		{#if showInsert}
			<aside class="flex w-80 max-w-[60%] shrink-0 flex-col border-l border-surface-500/30 bg-surface-50 dark:bg-surface-900">
				<InsertPanel onPick={(source, row) => addCard(source, source.kind === "pair" ? row : null)} onClose={() => (showInsert = false)} />
			</aside>
		{/if}
	</div>
</div>
