<script>
	// Global menu actions: mounted once by the layout, so they work on every
	// route regardless of which page mounted first. Registers a live handler
	// per catalog action with the central dispatcher, keeps the dispatcher's
	// catalog (extensions) and platform current, and renders the global
	// Marasi menu used where a page has no menu of its own.
	import { goto } from "$app/navigation";
	import { onMount } from "svelte";
	import { get } from "svelte/store";
	import {
		getDrawerStore,
		getModalStore,
		getToastStore,
		modeCurrent,
	} from "@skeletonlabs/skeleton";
	import { ChromeIcon, ToolIcon } from "svelte-feather-icons";
	import {
		AArrowDown,
		AArrowUp,
		ALargeSmall,
		AnchorIcon,
		ArrowUpCircle,
		Binoculars,
		BookIcon,
		BookOpenCheckIcon,
		CompassIcon,
		Copy,
		Download,
		FlagIcon,
		FolderOpen,
		PartyPopper,
		SendIcon,
		Settings,
		Swords,
		Sun,
		ToggleLeft,
	} from "lucide-svelte";
	import MarasiKeys from "./MarasiKeys.svelte";
	import ExtensionUI from "../../extensions/ExtensionUI.svelte";
	import {
		StartBrowser,
		ToggleFlag,
		ToggleIntercept,
	} from "../../wailsjs/go/main/App";
	import { updatePanelModal } from "../../updates.js";
	import { checkForUpdatesAndShowResult } from "../../../stores/updateStore";
	import {
		extensions,
		extensions_ui,
		interceptFlag,
		keybindingState,
		marasiConfig,
	} from "../../../stores.js";
	import {
		chromeError,
		copyCertificate,
		downloadCertificate,
		listenerModal,
		openProjectPicker,
	} from "../../globalActions.js";
	import { menuDispatcher } from "../../keybindings/app.js";
	import {
		DEFAULT_TEXT_SIZE,
		largerTextSize,
		smallerTextSize,
	} from "../../textSize.js";
	import { setTextSize, textSize } from "../../../stores/textSizeStore.js";
	import { setLightMode } from "../../lightMode.js";
	import {
		buildCatalog,
		extensionsWithGUI,
		extensionNavigationActionId,
	} from "../../keybindings/catalog.js";
	import { OPEN_MENU } from "../../keybindings/dispatcher.js";
	import { platformFromDesktopOS } from "../../keybindings/platform.js";

	const drawerStore = getDrawerStore();
	const modalStore = getModalStore();
	const toastStore = getToastStore();

	function closeAndGoto(url) {
		drawerStore.close();
		modalStore.close();
		document.querySelector("dialog[open]")?.close();
		goto(url);
	}

	// Changes the Text size, or does nothing when it is already that size,
	// as at either end of the scale. The change itself is the feedback.
	function changeTextSize(step) {
		const current = get(textSize);
		const next = step(current);
		if (next !== current) setTextSize(next);
	}

	// Opens the modal, or closes it when it is already on top.
	function toggleModal(settings) {
		const top = get(modalStore)[0];
		if (!top) modalStore.trigger(settings);
		else if (top.component === settings.component) modalStore.close();
	}

	const handlers = {
		"global.go-home": () => closeAndGoto("/"),
		"global.go-ledger": () => closeAndGoto("/ledger"),
		"global.go-compass": () => closeAndGoto("/compass"),
		"global.go-checkpoint": () => closeAndGoto("/checkpoint"),
		"global.go-launchpad": () => closeAndGoto("/launchpad"),
		"global.go-armory": () => closeAndGoto("/armory"),
		"global.go-logbook": () => closeAndGoto("/logbook"),
		"global.go-workshop": () => closeAndGoto("/workshop"),
		"global.go-settings": () => closeAndGoto("/settings"),
		"global.start-chrome": () =>
			StartBrowser("").catch(chromeError(toastStore, "Error starting Chrome")),
		"global.download-certificate": () => downloadCertificate(toastStore),
		"global.copy-certificate": () => copyCertificate(toastStore),
		"global.jump-to-toast": () => {
			const action = get(toastStore).at(-1)?.action;
			drawerStore.close();
			modalStore.close();
			document.querySelector("dialog[open]")?.close();
			action?.response();
		},
		"global.open-project": () => {
			const top = get(modalStore)[0];
			if (!top) openProjectPicker(toastStore, modalStore);
			else if (top.toggleAction === "global.open-project") modalStore.close();
		},
		"global.setup-listener": () => toggleModal(listenerModal(toastStore)),
		"global.toggle-vim": () =>
			ToggleFlag("vim_enabled").then((config) =>
				marasiConfig.set(config),
			),
		"global.toggle-light-mode": () => setLightMode(!get(modeCurrent)),
		"global.increase-text-size": () => changeTextSize(largerTextSize),
		"global.decrease-text-size": () => changeTextSize(smallerTextSize),
		"global.reset-text-size": () => changeTextSize(() => DEFAULT_TEXT_SIZE),
		"global.check-for-updates": checkForUpdates,
		"global.toggle-intercept": () =>
			ToggleIntercept().then((flag) => interceptFlag.set(flag)),
	};

	// "Check for updates…": an update opens the details panel; otherwise a
	// toast says why there is none.
	function checkForUpdates() {
		return checkForUpdatesAndShowResult(toastStore, () =>
			toggleModal(updatePanelModal()),
		);
	}

	const icons = {
		"global.go-home": AnchorIcon,
		"global.go-ledger": BookIcon,
		"global.go-compass": CompassIcon,
		"global.go-checkpoint": FlagIcon,
		"global.go-launchpad": SendIcon,
		"global.go-armory": Swords,
		"global.go-logbook": BookOpenCheckIcon,
		"global.go-workshop": ToolIcon,
		"global.go-settings": Settings,
		"global.start-chrome": ChromeIcon,
		"global.download-certificate": Download,
		"global.copy-certificate": Copy,
		"global.jump-to-toast": PartyPopper,
		"global.open-project": FolderOpen,
		"global.setup-listener": Binoculars,
		"global.toggle-vim": ToggleLeft,
		"global.toggle-light-mode": Sun,
		"global.increase-text-size": AArrowUp,
		"global.decrease-text-size": AArrowDown,
		"global.reset-text-size": ALargeSmall,
		"global.check-for-updates": ArrowUpCircle,
		"global.toggle-intercept": ToggleLeft,
	};

	$: menuDispatcher.configure({
		platform: platformFromDesktopOS($marasiConfig.DesktopOS),
	});
	// Extension pages' rendered menus join the catalog. Extensions re-render
	// often (panels, icons), so the catalog is rebuilt only when a menu's
	// content changes.
	$: extensionMenusJSON = JSON.stringify(
		Object.fromEntries(
			Object.entries($extensions_ui)
				.filter(([, ui]) => Array.isArray(ui?.menu))
				.map(([name, ui]) => [name, ui.menu]),
		),
	);
	// Only extensions that rendered a GUI get a page and a navigation action,
	// like the rail; the list changes rarely, unlike their state.
	$: guiExtensionNames = extensionsWithGUI($extensions, $extensions_ui)
		.map((extension) => extension.Name)
		.join("\n");
	$: menuDispatcher.configure({
		catalog: buildCatalog({
			extensions: $extensions.filter((extension) =>
				guiExtensionNames.split("\n").includes(extension.Name),
			),
			extensionMenus: JSON.parse(extensionMenusJSON),
		}),
	});
	// The saved profile: the dispatcher resolves its active variant for the
	// current platform, or keeps factory shortcuts and reports a problem.
	$: if ($keybindingState) {
		menuDispatcher.configure({ keybindings: $keybindingState });
	}
	let reportedKeybindingProblem = "";
	$: if (
		$menuDispatcher.problem &&
		$menuDispatcher.problem !== reportedKeybindingProblem
	) {
		reportedKeybindingProblem = $menuDispatcher.problem;
		toastStore.trigger({
			message: `Keybindings: ${reportedKeybindingProblem}`,
			background: "variant-filled-warning",
		});
	}

	// Extension navigation handlers follow the loaded extensions.
	let unregisterExtensions = [];
	$: {
		unregisterExtensions.forEach((unregister) => unregister());
		unregisterExtensions = $extensions.map((extension) =>
			menuDispatcher.register(
				extensionNavigationActionId(extension.Name),
				() => closeAndGoto("/extension/" + extension.Name),
			),
		);
	}

	function extensionIcon(extension, extensionsUI) {
		const iconSchema = extensionsUI[extension.Name]?.icon;
		return {
			component: ExtensionUI,
			props: {
				extensionData: extension,
				schema: iconSchema ? { ...iconSchema, size: 14 } : null,
			},
		};
	}

	function entry(action, { intercept, loadedExtensions, extensionsUI }) {
		const extension = loadedExtensions.find(
			(ext) => extensionNavigationActionId(ext.Name) === action.id,
		);
		let name = action.label;
		if (action.id === "global.toggle-intercept") {
			name = intercept ? "Toggle Intercept Off" : "Toggle Intercept On";
		}
		return {
			actionId: action.id,
			name,
			subtitle: action.description,
			keywords: action.keywords,
			icon: extension
				? extensionIcon(extension, extensionsUI)
				: icons[action.id],
		};
	}

	$: menuOptions = $menuDispatcher.catalog
		.inContext("global")
		.filter((action) => action.id !== OPEN_MENU)
		.map((action) =>
			entry(action, {
				intercept: $interceptFlag,
				loadedExtensions: $extensions,
				extensionsUI: $extensions_ui,
			}),
		);

	onMount(() => {
		const unregister = Object.entries(handlers).map(([id, handler]) =>
			menuDispatcher.register(id, handler),
		);
		return () => {
			unregister.forEach((fn) => fn());
			unregisterExtensions.forEach((fn) => fn());
		};
	});
</script>

<MarasiKeys paletteTier="global" {menuOptions} />
