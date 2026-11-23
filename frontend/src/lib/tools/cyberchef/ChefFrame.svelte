<script>
	// CyberChef, built from its pinned tag and served from the app's origin
	// (frontend/cyberchef/build.js), in a frame the app fully controls: its
	// keys go through Marasi's dispatcher, it takes the app's palette and Text
	// size, it shows the open recipe, and its Save and Load recipe buttons
	// open Rename and Switch. chefAdapter is the only code that reaches into
	// CyberChef itself. It keeps the shown recipe's input sources (send.js)
	// by tab, and tells the page the open tab's source (`open`).
	import { createEventDispatcher, onDestroy } from "svelte";
	import { getModalStore, modeCurrent } from "@skeletonlabs/skeleton";
	import { chefAdapter } from "./chefAdapter.js";
	import { chefColumns, chefTheme } from "./chefTheme.js";
	import { sourcesByTab, sourcesOfTabs } from "./send.js";
	import { forwardMenuShortcuts } from "../../keybindings/app.js";
	import { textScale } from "../../../stores/textSizeStore.js";
	import { mobileCheck } from "../../platform.js";
	import { installMenuSwipe } from "../../menuSwipe.js";

	/** The open recipe ({ id, operations, inputs, sources? }). */
	export let recipe;

	const dispatch = createEventDispatcher();
	// Skeleton's modal store, which the tool harness doesn't set up.
	let modalStore = null;
	try {
		modalStore = getModalStore();
	} catch {
		// No modals to keep the menu from opening over.
	}
	// What CyberChef holds is recorded this often, and before a switch.
	const SNAPSHOT_MS = 500;

	let frame;
	let adapter = null;
	let shownId = null;
	let loading = Promise.resolve();
	let stopKeys = () => {};
	let stopSwipe = () => {};
	let resizes;
	let poll;
	// The shown recipe's input sources, by input tab number.
	let byTab = new Map();
	let openKey = "";

	function applyTheme(dark, scale) {
		const doc = frame?.contentDocument;
		if (!adapter || !doc) return;
		const body = getComputedStyle(document.body);
		const theme = chefTheme((name) => body.getPropertyValue(name), { dark, scale });
		adapter.setTheme(theme.themeClass);
		let style = doc.getElementById("marasi-theme");
		if (!style) {
			style = doc.createElement("style");
			style.id = "marasi-theme";
			doc.head.appendChild(style);
		}
		style.textContent = theme.css;
		fitColumns(scale);
	}

	// CyberChef's columns, refit when the frame's width or the Text size
	// changes, so the Recipe column keeps its share on a narrow frame.
	let fitted = "";
	function fitColumns(scale = $textScale) {
		const width = frame?.clientWidth;
		if (!adapter || !width) return;
		const key = `${width}:${scale}`;
		if (key === fitted) return;
		fitted = key;
		try {
			adapter.setColumns(chefColumns(width, scale));
		} catch {
			// The frame is going away.
		}
	}

	// Records what CyberChef holds for the recipe it shows, when that changed.
	// It is keyed on the shown recipe, not the `recipe` prop: the tabs open
	// another recipe first, and the one being left is recorded on the way.
	let recorded = "";
	async function snapshot() {
		const id = shownId;
		if (!adapter || !id) return;
		try {
			const operations = adapter.getRecipe();
			const tabs = await adapter.getInputTabs();
			if (id !== shownId) return;
			const nums = tabs.map((tab) => tab.num);
			// A removed tab's source goes with it.
			for (const num of byTab.keys()) if (!nums.includes(num)) byTab.delete(num);
			tellOpen();
			const inputs = tabs.map((tab) => tab.text);
			const sources = sourcesOfTabs(nums, byTab);
			const now = JSON.stringify({ operations, inputs, sources });
			if (now === recorded) return;
			recorded = now;
			dispatch("change", { id, operations, inputs, sources });
		} catch {
			// The frame is going away.
		}
	}

	// Tells the page the open input tab and its source when either changed.
	function tellOpen() {
		if (!adapter || !shownId) return;
		const num = adapter.openTab();
		const source = byTab.get(num) ?? null;
		const key = JSON.stringify([shownId, num, source]);
		if (key === openKey) return;
		openKey = key;
		dispatch("open", { num, source });
	}

	async function show(next) {
		if (!adapter || next.id === shownId) return;
		await snapshot();
		shownId = null;
		dispatch("loading", true);
		try {
			await adapter.load(next);
			const tabs = await adapter.getInputTabs();
			const nums = tabs.map((tab) => tab.num);
			byTab = sourcesByTab(nums, next.sources);
			shownId = next.id;
			recorded = JSON.stringify({
				operations: next.operations ?? [],
				inputs: tabs.map((tab) => tab.text),
				sources: sourcesOfTabs(nums, byTab),
			});
			tellOpen();
		} catch (err) {
			dispatch("error", { error: err });
		} finally {
			dispatch("loading", false);
		}
	}

	// CyberChef's Save and Load recipe buttons, and its Load key (Ctrl+Alt+L),
	// are the app's Rename and Switch; its local storage never holds recipes.
	function interceptRecipeButtons(win, doc) {
		win.addEventListener(
			"keydown",
			(event) => {
				if (!(event.ctrlKey && event.altKey && event.code === "KeyL")) return;
				event.preventDefault();
				event.stopImmediatePropagation();
				dispatch("loadRecipe");
			},
			true,
		);
		doc.addEventListener(
			"click",
			(event) => {
				const button = event.target.closest?.("#save, #load");
				if (!button) return;
				event.preventDefault();
				event.stopImmediatePropagation();
				dispatch(button.id === "save" ? "saveRecipe" : "loadRecipe");
			},
			true,
		);
	}

	async function onLoad() {
		const win = frame.contentWindow;
		const next = chefAdapter(win);
		try {
			await next.ready();
		} catch (err) {
			dispatch("error", { error: err });
			return;
		}
		adapter = next;
		stopKeys();
		stopKeys = forwardMenuShortcuts(win);
		interceptRecipeButtons(win, frame.contentDocument);
		// The frame's touches never reach the app's window, so the swipe
		// that opens the Marasi menu is installed in the frame as well. Not
		// awaited: the recipe must load before anything else runs here.
		stopSwipe();
		mobileCheck.then((onMobile) => {
			if (onMobile && adapter === next) stopSwipe = installMenuSwipe(win, modalStore);
		});
		fitted = "";
		applyTheme(!$modeCurrent, $textScale);
		resizes?.disconnect();
		resizes = new ResizeObserver(() => fitColumns());
		resizes.observe(frame);
		loading = show(recipe);
		await loading;
		clearInterval(poll);
		poll = setInterval(snapshot, SNAPSHOT_MS);
		dispatch("ready", { adapter });
	}

	$: applyTheme(!$modeCurrent, $textScale);
	$: if (adapter && recipe) loading = loading.then(() => show(recipe));

	/** Records what CyberChef holds now, before something reads the recipe. */
	export function flush() {
		return snapshot();
	}

	/** Sets (or, with null, clears) input tab `num`'s source, and records it. */
	export function setSource(num, source) {
		if (source) byTab.set(num, source);
		else byTab.delete(num);
		return snapshot();
	}

	onDestroy(() => {
		clearInterval(poll);
		stopKeys();
		stopSwipe();
		resizes?.disconnect();
	});
</script>

<iframe
	bind:this={frame}
	src="/tools/cyberchef/index.html"
	title="CyberChef"
	class="absolute inset-0 h-full w-full border-0"
	data-testid="cyberchef-frame"
	on:load={onLoad}
></iframe>
