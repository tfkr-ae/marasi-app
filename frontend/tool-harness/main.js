// The tool contract checks' harness (scripts/check-tools.sh). It mounts the
// app's real Excalidraw island and CyberChef frame, built from the pinned
// versions, with the app's real keybinding dispatcher, and no Marasi service.
// frontend/tool-checks/check-browser.js drives it from headless Chrome
// through window.harness.
//
// It is its own Vite app (tool-harness/vite.config.js), outside src/routes,
// so the app's build never contains it; check-release.js proves that on the
// release build.
import ExcalidrawIsland from "../src/lib/tools/ExcalidrawIsland.svelte";
import ChefFrame from "../src/lib/tools/cyberchef/ChefFrame.svelte";
import { installMenuShortcuts, menuDispatcher, menuPalettes, registerMenuActions } from "../src/lib/keybindings/app.js";
import { MACOS, WINDOWS_LINUX } from "../src/lib/keybindings/platform.js";

const params = new URLSearchParams(location.search);
menuDispatcher.configure({ platform: params.get("platform") === "macos" ? MACOS : WINDOWS_LINUX });

// What reached the app: menu toggles, actions and the frame's events.
const events = [];
const record = (name, detail = null) => events.push({ name, detail });

// The dispatcher state the root layout would report on the tool's route.
let route = "/";
installMenuShortcuts(() => ({ route, modal: null, dialogOpen: false, capturing: false }));
// The page's Marasi menu: ⌘K toggles the most specific mounted one.
menuPalettes.register("page", { toggle: () => record("menu") });

const stage = document.getElementById("stage");
let teardown = () => {};

function reset(nextRoute) {
	teardown();
	teardown = () => {};
	stage.replaceChildren();
	events.length = 0;
	route = nextRoute;
}

const loadExcalidraw = () => import("@excalidraw/excalidraw");

let island = null;
let chef = null;
let raw = null;

window.harness = {
	events: () => events.map((event) => ({ ...event })),
	clearEvents: () => {
		events.length = 0;
	},

	/** Mounts the app's Excalidraw island with `skeletons` (convertToExcalidrawElements input). */
	async excalidraw({ dark = false, skeletons = [] } = {}) {
		reset("/excalidraw");
		const mount = (elements) =>
			new ExcalidrawIsland({
				target: stage,
				props: { drawing: { id: "harness", scene: { elements }, files: {} }, dark },
			});
		// The island loads Excalidraw first, as on the app's page: Excalidraw
		// reads its asset path (the app's fonts) when its module loads.
		island = mount([]);
		if (skeletons.length) {
			while (!stage.querySelector(".excalidraw")) await new Promise((resolve) => setTimeout(resolve, 50));
			const elements = (await loadExcalidraw()).convertToExcalidrawElements(skeletons);
			island.$destroy();
			island = mount(elements);
		}
		// As the Excalidraw page registers it.
		const stop = registerMenuActions([
			{
				actionId: "excalidraw.shortcuts",
				handler: () => {
					record("excalidraw.shortcuts");
					island.openHelp();
				},
			},
		]);
		teardown = () => {
			stop();
			island.$destroy();
			island = null;
		};
	},

	setDark(dark) {
		island.$set({ dark });
	},

	/**
	 * Mounts Excalidraw itself, as the island does, with embeddables passed
	 * by validateEmbeddable and drawn by renderEmbeddable: the API cards are
	 * built on (issue 02). Each embeddable draws a stand-in card naming its
	 * link. Resolves once the API is ready.
	 */
	async embeddables({ skeletons = [] } = {}) {
		reset("/excalidraw");
		const [react, reactDom, lib] = await Promise.all([
			import("react"),
			import("react-dom/client"),
			loadExcalidraw(),
			import("@excalidraw/excalidraw/index.css"),
		]);
		const React = react.default ?? react;
		const host = document.createElement("div");
		host.style.cssText = "position:absolute;inset:0";
		stage.append(host);
		const root = (reactDom.default ?? reactDom).createRoot(host);
		let resolveApi;
		const ready = new Promise((resolve) => (resolveApi = resolve));
		root.render(
			React.createElement(lib.Excalidraw, {
				initialData: { elements: lib.convertToExcalidrawElements(skeletons), scrollToContent: false },
				excalidrawAPI: resolveApi,
				validateEmbeddable: (link) => link.startsWith("marasi://"),
				renderEmbeddable: (element) =>
					React.createElement(
						"div",
						{ "data-harness-card": element.link, style: { width: "100%", height: "100%", background: "#fff" } },
						element.link,
					),
			}),
		);
		raw = { api: await ready, lib };
		teardown = () => {
			root.unmount();
			raw = null;
		};
	},

	/** The mounted embeddables scene, as plain data. */
	sceneElements() {
		return raw.api.getSceneElements().map((element) => ({ ...element }));
	},

	/** Sets an element's size, as a card does when its content changes. */
	resizeElement(id, { width, height }) {
		const elements = raw.api.getSceneElements().map((element) =>
			element.id === id
				? { ...element, width: width ?? element.width, height: height ?? element.height, version: element.version + 1, versionNonce: element.versionNonce + 1 }
				: element,
		);
		raw.api.updateScene({ elements });
	},

	/**
	 * Exports the mounted scene as SVG with the scene embedded, then loads it
	 * back as Excalidraw would load a dropped file.
	 */
	async svgRoundTrip() {
		const { api, lib } = raw;
		const svg = await lib.exportToSvg({
			elements: api.getSceneElements(),
			appState: { ...api.getAppState(), exportEmbedScene: true, exportBackground: true },
			files: api.getFiles(),
		});
		const text = new XMLSerializer().serializeToString(svg);
		const loaded = await lib.loadFromBlob(new Blob([text], { type: "image/svg+xml" }), null, null);
		return { svg: text, elements: loaded.elements.map((element) => ({ id: element.id, type: element.type })) };
	},

	/** Mounts the app's CyberChef frame on `recipe`; resolves once it is ready. */
	cyberchef(recipe = { id: "harness", operations: [], inputs: [""] }) {
		reset("/cyberchef");
		chef = { adapter: null };
		const frame = new ChefFrame({ target: stage, props: { recipe } });
		const ready = new Promise((resolve, reject) => {
			frame.$on("ready", (event) => {
				chef.adapter = event.detail.adapter;
				resolve();
			});
			frame.$on("error", (event) => reject(new Error(event.detail.message)));
		});
		for (const name of ["saveRecipe", "loadRecipe", "error"]) frame.$on(name, (event) => record(name, event.detail ?? null));
		teardown = () => {
			frame.$destroy();
			chef = null;
		};
		return ready;
	},

	/** The adapter ChefFrame made, for the adapter checks. */
	chef: () => chef?.adapter,
};

window.harnessReady = true;
