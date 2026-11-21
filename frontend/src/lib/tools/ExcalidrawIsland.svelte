<script>
	// Excalidraw (a React component) mounted in the Svelte page, with no
	// frame, so Marasi's window key listener sees every key and the canvas
	// follows the app's theme (docs/adr/2026-11-21-excalidraw-is-a-react-
	// island-and-cards-are-the-apps-own-markup.md). React and Excalidraw load
	// the first time the page opens. Its fonts come from the app's own
	// static assets (excalidrawAssets.js), and every feature that reaches the
	// network or the file system is off.
	import { onDestroy, onMount } from "svelte";

	/** The drawing to show: { id, scene, files }. Remount (key it) to switch. */
	export let drawing;
	export let dark = false;
	/**
	 * Called with the drawing's id and its new { scene, files }, at most every
	 * 250 ms and on unmount. The id is the one this island mounted with.
	 */
	export let onChange = (_id, _content) => {};
	const drawingId = drawing.id;

	let host;
	let root;
	let React;
	let lib;
	let api = null;
	let saveTimer;
	let pending = null;
	let destroyed = false;
	let failed = "";

	/** Opens Excalidraw's help dialog, its list of shortcuts. */
	export function openHelp() {
		api?.updateScene({ appState: { openDialog: { name: "help" } } });
	}

	// The main menu without its network and file items (open, save, export,
	// collaboration, socials, Excalidraw+). The theme follows the app.
	function mainMenu() {
		const { MainMenu } = lib;
		const item = (Item) => React.createElement(Item, { key: Item.displayName ?? Item.name });
		return React.createElement(MainMenu, {}, [
			item(MainMenu.DefaultItems.SearchMenu),
			item(MainMenu.DefaultItems.Help),
			item(MainMenu.DefaultItems.ClearCanvas),
			React.createElement(MainMenu.Separator, { key: "separator" }),
			item(MainMenu.DefaultItems.ChangeCanvasBackground),
		]);
	}

	function render() {
		if (!root || !lib) return;
		root.render(
			React.createElement(lib.Excalidraw, {
				children: mainMenu(),
				theme: dark ? lib.THEME.DARK : lib.THEME.LIGHT,
				initialData: {
					elements: drawing.scene?.elements ?? [],
					appState: { ...(drawing.scene?.appState ?? {}), collaborators: new Map() },
					files: drawing.files ?? {},
					scrollToContent: false,
				},
				excalidrawAPI: (excalidrawApi) => {
					api = excalidrawApi;
				},
				aiEnabled: false,
				isCollaborating: false,
				UIOptions: {
					canvasActions: {
						loadScene: false,
						saveToActiveFile: false,
						export: false,
						saveAsImage: false,
					},
					tools: { image: true },
				},
				// Links on shapes open nothing outside the app.
				onLinkOpen: (_element, event) => event.preventDefault(),
				onChange: (elements, appState, files) => {
					pending = { elements, appState, files };
					clearTimeout(saveTimer);
					saveTimer = setTimeout(flush, 250);
				},
			}),
		);
	}

	function flush() {
		clearTimeout(saveTimer);
		if (!pending) return;
		const { elements, appState, files } = pending;
		pending = null;
		onChange(drawingId, {
			scene: {
				elements: lib.getNonDeletedElements(elements),
				appState: {
					viewBackgroundColor: appState.viewBackgroundColor,
					scrollX: appState.scrollX,
					scrollY: appState.scrollY,
					zoom: appState.zoom,
				},
			},
			files,
		});
	}

	onMount(async () => {
		window.EXCALIDRAW_ASSET_PATH = "/excalidraw-assets/";
		try {
			const [react, reactDom, excalidraw] = await Promise.all([
				import("react"),
				import("react-dom/client"),
				import("@excalidraw/excalidraw"),
				import("@excalidraw/excalidraw/index.css"),
			]);
			if (destroyed) return;
			React = react.default ?? react;
			lib = excalidraw;
			root = (reactDom.default ?? reactDom).createRoot(host);
			render();
		} catch (err) {
			console.error("Loading Excalidraw failed:", err);
			failed = "Couldn't load Excalidraw";
		}
	});

	// The theme follows the app without remounting.
	$: dark, render();

	onDestroy(() => {
		destroyed = true;
		flush();
		root?.unmount();
	});
</script>

<div bind:this={host} class="excalidraw-host" data-testid="excalidraw-canvas">
	{#if failed}<p class="p-4 text-xs">{failed}</p>{/if}
</div>

<style>
	.excalidraw-host {
		position: absolute;
		inset: 0;
	}
	/* No library: its browser opens libraries.excalidraw.com, and its menu
	   publishes there or loads and saves files. */
	.excalidraw-host :global(.default-sidebar-trigger),
	.excalidraw-host :global(.library-menu-browse-button),
	.excalidraw-host :global(.library-menu-dropdown-container) {
		display: none !important;
	}
</style>
