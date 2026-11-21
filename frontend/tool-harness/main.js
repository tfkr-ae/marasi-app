// The tool contract checks' harness (scripts/check-tools.sh). It mounts the
// app's real Excalidraw island and CyberChef frame, built from the pinned
// versions, with the app's real keybinding dispatcher, and no Marasi service.
// frontend/tool-checks/check-browser.js drives it from headless Chrome
// through window.harness.
//
// It is its own Vite app (tool-harness/vite.config.js), outside src/routes,
// so the app's build never contains it; check-release.js proves that on the
// release build.
import "../src/app.css";
import { modeCurrent } from "@skeletonlabs/skeleton";
import ExcalidrawIsland from "../src/lib/tools/ExcalidrawIsland.svelte";
import { createCardEmbed } from "../src/lib/tools/cardEmbed.js";
import { newCardElement } from "../src/lib/tools/cards.js";
import { drawingFile } from "../src/lib/tools/drawingFile.js";
import { logbookStore } from "../src/stores/logbookStore.js";
import ChefFrame from "../src/lib/tools/cyberchef/ChefFrame.svelte";
import { chefInbox, drainInbox, pairText } from "../src/lib/tools/cyberchef/send.js";
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
// The cards mode's Excalidraw: { api, lib }.
let up = null;

// The app's light or dark mode, as the layout sets it: Tailwind's dark
// class and Skeleton's modeCurrent (true in light).
function setMode(dark) {
	document.documentElement.classList.toggle("dark", dark);
	modeCurrent.set(!dark);
}

const until = async (check, message, ms = 15000) => {
	const start = Date.now();
	while (!check()) {
		if (Date.now() - start > ms) throw new Error(message);
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
};

// The share of near-white pixels in an image (a data URL): a light card is
// mostly its light surface.
async function lightShare(dataURL) {
	const image = new Image();
	image.src = dataURL;
	await image.decode();
	const canvas = document.createElement("canvas");
	canvas.width = image.naturalWidth;
	canvas.height = image.naturalHeight;
	const context = canvas.getContext("2d");
	context.drawImage(image, 0, 0);
	const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
	let light = 0;
	for (let i = 0; i < data.length; i += 4) if (data[i] > 225 && data[i + 1] > 225 && data[i + 2] > 225) light++;
	return light / (data.length / 4);
}

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
		setMode(dark);
		island?.$set({ dark });
	},

	/**
	 * Mounts the island with the app's cards (cardEmbed.js), as the
	 * Excalidraw page does, over the Logbook's `findings` (as the service's
	 * events deliver them). Resolves once Excalidraw is up.
	 */
	async cards({ dark = false, findings = [] } = {}) {
		reset("/excalidraw");
		setMode(dark);
		up = null;
		for (const finding of findings) logbookStore.applyRecord("finding", finding);
		const cards = createCardEmbed({ excalidraw: () => up, onOpen: (source) => record("open", source) });
		let stopChange = () => {};
		island = new ExcalidrawIsland({
			target: stage,
			props: {
				drawing: { id: "cards", scene: { elements: [] }, files: {} },
				dark,
				embed: cards.embed,
				onReady: (api, lib) => {
					up = { api, lib };
					stopChange = api.onChange((elements, appState) => cards.noteChange(elements, appState));
				},
			},
		});
		await until(() => up, "Excalidraw didn't come up");
		teardown = () => {
			stopChange();
			island.$destroy();
			island = null;
			up = null;
		};
	},

	/** Adds a card for `source` at scene point `at`, as Insert does; resolves to its id. */
	addCard(source, at) {
		const { api, lib } = up;
		const [element] = lib.restoreElements([newCardElement(source, at)], null);
		api.updateScene({
			elements: [...api.getSceneElementsIncludingDeleted(), element],
			captureUpdate: lib.CaptureUpdateAction.IMMEDIATELY,
		});
		return element.id;
	},

	/** A finding changed elsewhere, as its service event applies it. */
	changeFinding(fields) {
		logbookStore.applyRecord("finding", fields);
	},

	/**
	 * Moves card `id` by (dx, dy) outside the undo history, as a content fit
	 * moves cards: Excalidraw updates no bound arrow for it.
	 */
	moveCard(id, dx, dy) {
		const { api, lib } = up;
		api.updateScene({
			elements: api
				.getSceneElementsIncludingDeleted()
				.map((element) => (element.id === id ? lib.newElementWith(element, { x: element.x + dx, y: element.y + dy }) : element)),
			captureUpdate: lib.CaptureUpdateAction.NEVER,
		});
	},

	/** The cards mode's scroll and zoom. */
	cardAppState() {
		const { scrollX, scrollY, zoom } = up.api.getAppState();
		return { scrollX, scrollY, zoom: zoom.value };
	},

	/** The canvas zoom in the cards mode. */
	cardZoom() {
		return up.api.getAppState().zoom.value;
	},

	/** The cards mode's scene, as plain data. */
	cardScene() {
		return up.api.getSceneElements().map((element) => ({ ...element }));
	},

	/**
	 * The SVG Attach… uploads (drawingFile.js), loaded back as Excalidraw
	 * loads a dropped file: its text, the elements in drawing order, and how
	 * light each embedded image is.
	 */
	async attachmentSvg() {
		const { api, lib } = up;
		const file = await drawingFile(lib, api, "harness", "svg");
		const text = await file.text();
		const loaded = await lib.loadFromBlob(new Blob([text], { type: "image/svg+xml" }), null, null);
		const images = {};
		for (const element of loaded.elements) {
			if (element.type === "image") images[element.id] = await lightShare(loaded.files[element.fileId].dataURL);
		}
		return {
			name: file.name,
			svg: text,
			elements: loaded.elements.map(({ id, type, link, customData, x, y, width, height, points }) => ({
				id,
				type,
				link,
				customData,
				x,
				y,
				width,
				height,
				points,
			})),
			lightShare: images,
		};
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
			frame.$on("error", (event) => reject(event.detail.error));
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

	/** Inserts a pair's raw text as the CyberChef page's Insert does: through the inbox. */
	async insertPair(raw) {
		chefInbox.update((list) => [...list, pairText(raw)]);
		await drainInbox(chefInbox, chef.adapter);
	},
};

window.harnessReady = true;
