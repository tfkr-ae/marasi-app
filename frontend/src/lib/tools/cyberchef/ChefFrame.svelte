<script>
	// CyberChef, built from its pinned tag and served from the app's origin
	// (frontend/cyberchef/build.js), in a frame the app fully controls: its
	// keys go through Marasi's dispatcher, it takes the app's palette and Text
	// size, it shows the open recipe, and its Save and Load recipe buttons
	// open Rename and Switch. chefAdapter is the only code that reaches into
	// CyberChef itself.
	import { createEventDispatcher, onDestroy } from "svelte";
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import { chefAdapter } from "./chefAdapter.js";
	import { chefTheme } from "./chefTheme.js";
	import { forwardMenuShortcuts } from "../../keybindings/app.js";
	import { textSize } from "../../../stores/textSizeStore.js";

	/** The open recipe ({ id, operations, inputs }). */
	export let recipe;

	const dispatch = createEventDispatcher();
	// What CyberChef holds is recorded this often, and before a switch.
	const SNAPSHOT_MS = 500;

	let frame;
	let adapter = null;
	let shownId = null;
	let loading = Promise.resolve();
	let stopKeys = () => {};
	let poll;

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
	}

	// Records the shown recipe's operations and inputs when they changed.
	async function snapshot() {
		if (!adapter || shownId !== recipe.id) return;
		const id = shownId;
		try {
			const operations = adapter.getRecipe();
			const inputs = await adapter.getInputs();
			if (id !== shownId) return;
			if (JSON.stringify(operations) !== JSON.stringify(recipe.operations) || JSON.stringify(inputs) !== JSON.stringify(recipe.inputs)) {
				dispatch("change", { id, operations, inputs });
			}
		} catch {
			// The frame is going away.
		}
	}

	async function show(next) {
		if (!adapter || next.id === shownId) return;
		await snapshot();
		shownId = null;
		dispatch("loading", true);
		try {
			await adapter.load(next);
			shownId = next.id;
		} catch (err) {
			dispatch("error", { message: String(err?.message ?? err) });
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
			dispatch("error", { message: String(err?.message ?? err) });
			return;
		}
		adapter = next;
		stopKeys();
		stopKeys = forwardMenuShortcuts(win);
		interceptRecipeButtons(win, frame.contentDocument);
		applyTheme(!$modeCurrent, $textSize.scale);
		loading = show(recipe);
		await loading;
		clearInterval(poll);
		poll = setInterval(snapshot, SNAPSHOT_MS);
		dispatch("ready", { adapter });
	}

	$: applyTheme(!$modeCurrent, $textSize.scale);
	$: if (adapter && recipe) loading = loading.then(() => show(recipe));

	/** Records what CyberChef holds now, before something reads the recipe. */
	export function flush() {
		return snapshot();
	}

	onDestroy(() => {
		clearInterval(poll);
		stopKeys();
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
