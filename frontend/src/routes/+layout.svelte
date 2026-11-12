<script>
	import Logo from "../lib/components/Logo.svelte";
	import OpeningScreen from "../lib/components/OpeningScreen.svelte";
	import ConnectionBanner from "../lib/components/ConnectionBanner.svelte";
	import ConnectionsModal from "../lib/connection/ConnectionsModal.svelte";
	import QuitQuestionModal from "../lib/connection/QuitQuestionModal.svelte";
	import { QUIT_QUESTION_EVENT, quitAnswerOf } from "../lib/connection/quitQuestion.js";
	import ConnectionRailTile from "../lib/connection/ConnectionRailTile.svelte";
	import OutdatedInstance from "../lib/connection/OutdatedInstance.svelte";
	import { filePickerShown, pagesHeld, startupOffersConnections, startupText } from "../lib/connection/status.js";
	import { neutralVariant, primaryVariant } from "../lib/launchpad/format.js";
	import {
		computePosition,
		autoUpdate,
		offset,
		shift,
		flip,
		arrow,
	} from "@floating-ui/dom";
	import { getDrawerStore, storePopup } from "@skeletonlabs/skeleton";
	import {
		initializeStores,
		Toast,
		Modal,
		getToastStore,
		getModalStore,
		LightSwitch,
		modeCurrent,
		autoModeWatcher,
	} from "@skeletonlabs/skeleton";
	initializeStores();
	import { onMount } from "svelte";

	import { AppRail, AppRailAnchor } from "@skeletonlabs/skeleton";
	import {
		BookIcon,
		SettingsIcon,
		SendIcon,
		ToolIcon,
		FlagIcon,
		CompassIcon,
		ZapIcon,
	} from "svelte-feather-icons";
	import { goto, preloadCode } from "$app/navigation";
	import "../app.css";
	let currentTile = 0;
	import { page } from "$app/stores";
	import {
		activeProject,
		readConfig,
		extensions,
		extensions_ui,
		appState,
	} from "../stores.js";
	import {
		projectStore,
		opening,
		openingShown,
		pagesKey,
		loadedProject,
	} from "../stores/projectStore.js";
	import { openProjectFile, retryOpen } from "../lib/globalActions.js";
	import { connectionStore } from "../stores/connectionStore";
	import {
		CLI_UPDATE_CHECKED_EVENT,
		cliUpdateCheckedNotice,
		outdatedVersion,
		shouldOfferCLISetup,
	} from "../lib/connection/cli.js";
	import { connectionsModal } from "../lib/connection/modal.js";
	import { reportUnsavedDrafts } from "../stores/launchpadStore";
	import { reportLogbookEdits } from "../stores/logbookStore";
	import { showExtensionToasts } from "../stores/extensionsStore.js";
	import { extensionToast } from "../lib/extensions/toast.js";
	import WebComponent from "../lib/extensions/WebComponent.svelte";
	import {
		checkpointItemContext,
		checkpointStore,
	} from "../stores/checkpointStore";
	import { checkpointBadge } from "../lib/checkpointBadge.js";
	import { armoryBadge } from "../lib/armory/armoryBadge.js";
	import { activeCountsOf, armoryStore } from "../stores/armoryStore";
	import { keyOf } from "../lib/checkpoint/itemContext.js";
	import { abandonLabel, abandonText } from "../lib/checkpoint/items.js";
	import { drawerKeybindingState, ledgerStore } from "../stores/ledgerStore";
	import { applyTextSize, textSize } from "../stores/textSizeStore.js";
	import { off, on, setWindowTitle } from "../lib/runtime.js";
	import { mobile, mobileCheck, platformCheck } from "../lib/platform.js";
	import { androidBack } from "../lib/androidBack.js";
	import { installSwipeToClose } from "../lib/swipeToClose.js";
	import { installLongPress, installTwoFingerSwipeDown, keepKeyboardDown } from "../lib/touch.js";
	import AppDrawer from "../lib/components/AppDrawer.svelte";
	import NotesModal from "../lib/components/NotesModal.svelte";
	import RecordModal from "../lib/logbook/RecordModal.svelte";
	import SelectFindingModal from "../lib/components/SelectFindingModal.svelte";
	import SelectWordlistModal from "../lib/components/SelectWordlistModal.svelte";
	import { AnswerQuitQuestion, OpenFileDialog } from "../lib/bindings/github.com/tfkr-ae/marasi-app/app.js";
	import {
		ChefHat,
		Brush,
		BookOpenCheckIcon,
		HomeIcon,
		PuzzleIcon,
		Swords,
	} from "lucide-svelte";
	import BottomBar from "../lib/components/BottomBar.svelte";
	import MenuModal from "../lib/components/MenuModal.svelte";
	import MetadataModal from "../lib/components/MetadataModal.svelte";
	import InterfaceModal from "../lib/components/InterfaceModal.svelte";
	import ProjectModal from "../lib/components/ProjectModal.svelte";
	import StartupStepper from "../lib/components/StartupStepper.svelte";
	import ExtensionUI from "../lib/extensions/ExtensionUI.svelte";
	import ModalWrapper from "../lib/extensions/components/ExtensionModalWrapper.svelte";
	import SelectTestCaseModal from "../lib/components/SelectTestCaseModal.svelte";
	import { closeTopOverlay, isolateOverlays } from "../lib/overlayIsolation.js";
	import WebSocketModal from "../lib/components/WebSocketModal.svelte";
	import KeybindingsModal from "../lib/components/Keybindings/KeybindingsModal.svelte";
	import GlobalMenu from "../lib/components/MarasiMenu/GlobalMenu.svelte";
	import UpdateModal from "../lib/components/UpdateModal.svelte";
	import UpstreamProxyModal from "../lib/components/UpstreamProxyModal.svelte";
	import UpstreamProxyCAModal from "../lib/components/UpstreamProxyCAModal.svelte";
	import ExportReview from "../lib/logbook/ExportReview.svelte";
	import {
		updateState,
		refreshUpdateState,
		onUpdateAvailable,
		onUpdateProgress,
		onUpdateInstalled,
		onUpdateFailed,
	} from "../stores/updateStore";
	import {
		settingsIconIndicator,
		settingsPath,
		updateIndicatorLabel,
	} from "../lib/updates.js";
	import { get } from "svelte/store";
	import {
		installMenuShortcuts,
		menuDispatcher,
		menuPalettes,
		websocketTab,
		armoryDrawer,
		keybindingCapture,
	} from "../lib/keybindings/app.js";
	let appRailIndex = 0;
	let showChef = false;
	let showExcali = false;
	let showInteract = false;

	// Lazy-loaded components
	let SvelteChef;
	let Excalidraw;
	let Interact;

	// Dynamic imports for heavy components
	const loadSvelteChef = async () => {
		if (!SvelteChef) {
			const module = await import(
				"../lib/components/SvelteChef.svelte"
			);
			SvelteChef = module.default;
		}
	};

	const loadExcalidraw = async () => {
		if (!Excalidraw) {
			const module = await import(
				"../lib/components/Excalidraw.svelte"
			);
			Excalidraw = module.default;
		}
	};

	const loadInteract = async () => {
		if (!Interact) {
			const module = await import(
				"../lib/components/Interact.svelte"
			);
			Interact = module.default;
		}
	};
	const toastStore = getToastStore();
	const modalStore = getModalStore();
	// Go waits for the answer to quit, so the question goes in front of any
	// open modal, and closing it any other way cancels the quit.
	function onQuitQuestion(question) {
		const modal = {
			type: "component",
			component: "QuitQuestion",
			meta: { question },
			response: (response) => {
				const { answer, remember } = quitAnswerOf(response);
				AnswerQuitQuestion(answer, remember).catch((err) =>
					console.error("Answering the quit question failed:", err),
				);
			},
		};
		modalStore.update((queue) => [modal, ...queue]);
	}
	// The Settings icon's update indicator (see settingsIconIndicator).
	$: settingsIndicator = settingsIconIndicator($updateState);
	// The Checkpoint icon's intercepted-count badge (see checkpointBadge).
	$: heldBadge = checkpointBadge($checkpointStore.items.length);
	// The Armory icon's runs-in-progress badge (see armoryBadge).
	$: runningBadge = armoryBadge(activeCountsOf($armoryStore).total);
	// The narrow iOS bottom bar's pages (BottomBar.svelte), going where the
	// rail's tiles go: Home and the main four in the bar, the rest under More.
	$: barPrimary = [
		{ id: "home", label: "Home", icon: HomeIcon, path: "/", go: () => goto("/") },
		{ id: "ledger", label: "Ledger", icon: BookIcon, path: "/ledger", go: () => goto("/ledger") },
		{ id: "checkpoint", label: "Checkpoint", icon: FlagIcon, path: "/checkpoint", badge: heldBadge.label, go: () => goto("/checkpoint") },
		{ id: "launchpad", label: "Launchpad", icon: SendIcon, path: "/launchpad", go: () => goto("/launchpad") },
		{ id: "logbook", label: "Logbook", icon: BookOpenCheckIcon, path: "/logbook", go: () => goto("/logbook") },
	];
	$: barMore = [
		{ id: "compass", label: "Compass", icon: CompassIcon, path: "/compass", go: () => goto("/compass") },
		{ id: "armory", label: "Armory", icon: Swords, path: "/armory", badge: runningBadge.label, go: () => goto("/armory") },
		{ id: "workshop", label: "Workshop", icon: ToolIcon, path: "/workshop", go: () => goto("/workshop") },
		{
			id: "chef",
			label: "Chef",
			icon: ChefHat,
			path: "/sveltechef",
			go: async () => {
				await loadSvelteChef();
				goto("/sveltechef");
				showChef = true;
			},
		},
		{
			id: "excalidraw",
			label: "Excalidraw",
			icon: Brush,
			path: "/excalidraw",
			go: async () => {
				await loadExcalidraw();
				goto("/excalidraw");
				showExcali = true;
			},
		},
		{
			id: "interact",
			label: "Interactsh",
			icon: ZapIcon,
			path: "/interact",
			go: async () => {
				await loadInteract();
				goto("/interact");
				showInteract = true;
			},
		},
		...$extensions
			.filter((extension) => $extensions_ui[extension.Name]?.icon || extension.UICode)
			.map((extension) => ({
				id: "extension-" + extension.Name,
				label: extension.Name,
				icon: PuzzleIcon,
				path: "/extension/" + extension.Name,
				go: () => goto("/extension/" + extension.Name),
			})),
		{
			id: "settings",
			label: "Settings",
			icon: SettingsIcon,
			path: "/settings",
			dot: settingsIndicator ? (settingsIndicator.kind === "dot" ? dotTones[settingsIndicator.tone].dot : "bg-primary-500") : "",
			go: () => goto(settingsPath($updateState)),
		},
	];
	// Each held item's context, for the Checkpoint page and the abandon
	// toast, which shows on any page.
	$: checkpointItemContext.load($checkpointStore.items);
	let stopAbandonToasts;
	// Full class names, so Tailwind keeps them.
	const dotTones = {
		success: { dot: "bg-success-500", ping: "bg-success-400" },
		error: { dot: "bg-error-500", ping: "bg-error-400" },
		tertiary: { dot: "bg-tertiary-500", ping: "bg-tertiary-400" },
	};
	const ringRadius = 17;
	const ringLength = 2 * Math.PI * ringRadius;
	const drawerStore = getDrawerStore();
	storePopup.set({
		computePosition,
		autoUpdate,
		offset,
		shift,
		flip,
		arrow,
	});
	const modalRegistery = {
		Startup: { ref: StartupStepper },
		Interface: { ref: InterfaceModal },
		Project: { ref: ProjectModal },
		Notes: { ref: NotesModal },
		MenuInput: { ref: MenuModal },
		Metadata: { ref: MetadataModal },
		// The finding and test case modal (lib/logbook/recordEditor.js).
		LogbookRecord: { ref: RecordModal },
		SelectTestCase: { ref: SelectTestCaseModal },
		WebsocketStream: { ref: WebSocketModal },
		SelectFinding: { ref: SelectFindingModal },
		SelectWordlist: { ref: SelectWordlistModal },
		"extension-modal": { ref: ModalWrapper },
		Keybindings: { ref: KeybindingsModal },
		Update: { ref: UpdateModal },
		UpstreamProxy: { ref: UpstreamProxyModal },
		UpstreamProxyCA: { ref: UpstreamProxyCAModal },
		ExportReport: { ref: ExportReview },
		Connections: { ref: ConnectionsModal },
		QuitQuestion: { ref: QuitQuestionModal },
	};
	// Text size sizes the root element, so everything in rem follows it.
	// readConfig sets it before startup draws any text.
	$: applyTextSize($textSize);
	// Startup reaches the Marasi service (the local instance, started or
	// attached to by the connection store), and carries on once the
	// service's project has loaded. It resolves to that project.
	let stopWaitingForProject = () => {};
	const StartupRoutine2 = new Promise((resolve) => {
		stopWaitingForProject = loadedProject.subscribe(
			(project) => project && resolve(project),
		);
		readConfig()
			.then(() => mobileCheck)
			.then((remoteOnly) => connectionStore.start({ remoteOnly }));
	});
	// With no Marasi CLI, the Connections modal opens by itself on its CLI
	// setup, once per failure (lib/connection/cli.js).
	let cliSetupOffered = false;
	$: if ($connectionStore.phase !== "failed") cliSetupOffered = false;
	$: if (shouldOfferCLISetup($connectionStore, cliSetupOffered)) {
		cliSetupOffered = true;
		openConnections();
	}
	// A phone with nothing paired opens Connections on its pairing, once.
	let pairingOffered = false;
	$: if ($connectionStore.phase === "unpaired" && !pairingOffered) {
		pairingOffered = true;
		openConnections();
	}
	// The start screen's Connections… opens the Connections modal over it,
	// so the researcher can switch before the app has loaded.
	function openConnections() {
		if ($modalStore[0]?.component !== "Connections") modalStore.trigger(connectionsModal());
	}
	// Mobile: modals and drawers leave the rail or bottom bar in view and in
	// use (app.css, overlayIsolation.js). A tap on one of its pages closes
	// the top one as Escape does; if it stays open (it asks about unsaved
	// edits first), the tap goes nowhere. More only opens its sheet.
	const liveNav = () => ($mobile ? ".nav-rail, .bottom-bar, .bottom-bar-backdrop" : null);
	const openOverlays = () => [$modalStore.length, $modalStore[0], $drawerStore.open];
	function closeOverlaysForNav(event) {
		if (!$mobile || !($modalStore.length || $drawerStore.open)) return;
		const tile = event.target?.closest?.(".nav-rail a, .nav-rail button, .bottom-bar button");
		if (!tile || tile.closest(".bottom-bar-more")) return;
		// The Connections tile toggles its modal: with it open, the tap only
		// closes it (left to reopen it, the modal flickered shut and back).
		const togglesConnections =
			$modalStore[0]?.component === "Connections" &&
			Boolean(tile.closest("[data-testid=bottom-bar-connections], [data-testid=connection-tile]"));
		// One at a time, as Escape would, until none is left or one stays.
		for (let i = 0; i < 8 && ($modalStore.length || $drawerStore.open); i++) {
			const before = openOverlays();
			closeTopOverlay();
			if (openOverlays().every((value, j) => value === before[j])) {
				event.preventDefault();
				event.stopPropagation();
				return;
			}
		}
		if (togglesConnections) {
			event.preventDefault();
			event.stopPropagation();
		}
	}
	// The state menu contexts and the shortcut gate are resolved against.
	function shortcutState() {
		return {
			route: get(page).url.pathname,
			modal: get(modalStore)[0]?.component ?? null,
			dialogOpen: Boolean(document.querySelector("dialog[open]")),
			drawer: get(drawerStore),
			ledgerDrawer: drawerKeybindingState(get(ledgerStore)),
			websocketTab: get(websocketTab),
			armoryDrawer: get(armoryDrawer),
			launchpadTreeFocused: Boolean(document.activeElement?.closest?.("[data-launchpad-tree]")),
			capturing: get(keybindingCapture),
		};
	}
	// A modal triggered with `toggleAction: <menu action id>` closes on that
	// action's current binding (overlayIsolation asks before Escape handling).
	function isModalToggle(event, actionId) {
		return menuDispatcher.isModalToggle(event, actionId, shortcutState());
	}
	let removeMenuShortcuts = () => {};
	// Mobile: a swipe down closes the open modal, drawer or menu.
	onMount(() => {
		let stop = () => {};
		mobileCheck.then((isMobile) => {
			if (isMobile) stop = installSwipeToClose(document, { close: closeTopOverlay, snapshot: openOverlays });
		});
		return () => stop();
	});
	// Android: Back asks the page first (MainActivity.handleBack).
	onMount(() => {
		platformCheck.then((name) => {
			if (name !== "android") return;
			window.marasiBack = () =>
				androidBack({
					closeTop: closeTopOverlay,
					historyIndex: history.state?.["sveltekit:history"] ?? 0,
					path: get(page).url.pathname,
					back: () => history.back(),
					home: () => goto("/"),
				});
		});
		return () => delete window.marasiBack;
	});
	onMount(() => {
		// Opens another client (the Marasi CLI, another app) starts while
		// the app is connected: the opening screen follows them, and the
		// connection store loads the opened project after the prompt.
		const stopFollowing = projectStore.follow({
			opened: (path) => connectionStore.followSwitch(path),
			failed: (name) =>
				toastStore.trigger({
					message: `Couldn't open ${name}`,
					background: "variant-filled-warning",
					timeout: 3000,
				}),
		});
		const stopReportingDrafts = reportUnsavedDrafts();
		const stopReportingLogbookEdits = reportLogbookEdits();
		const stopExtensionToasts = showExtensionToasts((schema) =>
			toastStore.trigger(extensionToast(schema)),
		);
		on("update-available", onUpdateAvailable);
		on(QUIT_QUESTION_EVENT, onQuitQuestion);
		on("update-progress", onUpdateProgress);
		on("update-installed", onUpdateInstalled);
		on("update-failed", onUpdateFailed);
		// The update check after Install placed the carried CLI found a newer one.
		const stopCLIUpdateToasts = on(CLI_UPDATE_CHECKED_EVENT, (result) => {
			const message = cliUpdateCheckedNotice(result);
			if (message) toastStore.trigger({ message });
		});
		refreshUpdateState();
		autoModeWatcher();
		StartupRoutine2.then((project) => {
			stopWaitingForProject();
			// The project that opened, which may not be the scratchpad, names
			// the window and the app's project, as a switch does.
			setWindowTitle(project.name);
			activeProject.set(project.name);
			appState.update((s) => ({ ...s, started: true, isReady: true }));
			removeMenuShortcuts = installMenuShortcuts(shortcutState);
			// The rail navigates by click, so nothing preloads the Ledger's
			// code on hover; load it now, so the first visit renders at once.
			preloadCode("/ledger").catch((err) =>
				console.error("Preloading the Ledger failed:", err),
			);

			// Marasi dropped a held item because its client left. The
			// toast shows on any page.
			stopAbandonToasts = checkpointStore.onAbandon(
				({ item, editLost }) => {
					const context =
						get(checkpointItemContext)[keyOf(item)];
					toastStore.trigger({
						message: abandonText(
							abandonLabel(item, context),
							editLost,
						),
						background: editLost
							? "variant-filled-warning"
							: "variant-filled-surface",
						timeout: 3000,
					});
				},
			);
		});
		// Touch fixes, on iOS only (lib/touch.js).
		let stopTouch = () => {};
		mobileCheck.then((onMobile) => {
			if (!onMobile) return;
			const stopLongPress = installLongPress(window);
			const stopKeyboard = keepKeyboardDown(modalStore, document);
			// Opens the Marasi menu, not over another dialog.
			const stopSwipe = installTwoFingerSwipeDown(window, () => {
				if (document.querySelector("dialog[open]") || $modalStore.length > 0) return;
				menuPalettes.active()?.toggle();
			});
			stopTouch = () => {
				stopLongPress();
				stopKeyboard();
				stopSwipe();
			};
		});
		return () => {
			stopTouch();
			stopFollowing();
			stopReportingDrafts();
			stopReportingLogbookEdits();
			removeMenuShortcuts();
			stopAbandonToasts?.();
			off("update-available");
			off(QUIT_QUESTION_EVENT);
			off("update-progress");
			off("update-installed");
			off("update-failed");
			stopCLIUpdateToasts();
			stopExtensionToasts();
		};
	});
</script>

<div
	class="app-frame flex flex-col h-screen safe-area-pad"
	use:isolateOverlays={{ modalStore, drawerStore, toastStore, isModalToggle, live: liveNav, quiet: () => $mobile }}
>
	<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
	<div class="app-body flex flex-1 h-screen" on:click|capture={closeOverlaysForNav}>
		{#if $appState.started}
			<GlobalMenu />
			<AppRail
				class="no-select h-full nav-rail"
				background="bg-surface-50-800-token"
				aspectRatio="py-2.5 px-1.5"
				width={$mobile ? "w-[var(--mobile-rail-width)]" : "w-[4.75rem]"}
				spacing="space-y-0.5"
			>
				<!-- AppRailTiles -->
				<AppRailAnchor
					regionLabel="!text-2xs !font-semibold leading-tight"
					selected={$page.url.pathname === "/"}
					on:click={() => {
						goto("/");
					}}
					bind:group={currentTile}
					name="Home"
					value={appRailIndex++}
					title="Home"
				>
					<svelte:fragment slot="lead">
						<div
							class="flex justify-center items-center w-full"
						>
							<Logo
								size={$mobile ? "36" : "52"}
								mode={$page.url.pathname ===
									"/" ||
								$modeCurrent
									? "light"
									: "dark"}
								selected={$page.url.pathname ===
									"/"}
							/>
						</div>
					</svelte:fragment>
					<span></span>
				</AppRailAnchor>
				<AppRailAnchor
					regionLabel="!text-2xs !font-semibold leading-tight"
					selected={$page.url.pathname ===
						"/ledger"}
					on:click={() => {
						goto("/ledger");
					}}
					bind:group={currentTile}
					name="Ledger"
					value={appRailIndex++}
					title="Ledger"
				>
					<svelte:fragment slot="lead">
						<div
							class="flex justify-center items-center w-full"
						>
							<BookIcon size="20" />
						</div>
					</svelte:fragment>
					<span>Ledger</span>
				</AppRailAnchor>
				<AppRailAnchor
					regionLabel="!text-2xs !font-semibold leading-tight"
					selected={$page.url.pathname ===
						"/compass"}
					on:click={() => {
						goto("/compass");
					}}
					bind:group={currentTile}
					name="Compass"
					value={appRailIndex++}
					title="Compass"
				>
					<svelte:fragment slot="lead">
						<div
							class="flex justify-center items-center w-full"
						>
							<CompassIcon size="20" />
						</div>
					</svelte:fragment>
					<span>Compass</span>
				</AppRailAnchor>
				<AppRailAnchor
					regionLabel="!text-2xs !font-semibold leading-tight"
					selected={$page.url.pathname ===
						"/checkpoint"}
					on:click={() => {
						goto("/checkpoint");
					}}
					bind:group={currentTile}
					name="Checkpoint"
					value={appRailIndex++}
					title={heldBadge.title}
				>
					<svelte:fragment slot="lead">
						<div
							class="relative flex justify-center items-center w-full"
						>
							<FlagIcon size="20" />
							{#if heldBadge.label}
								<span
									class="badge-icon variant-filled-primary pointer-events-none absolute left-1/2 -top-1.5 ml-1 h-auto min-w-[1.125rem] w-auto px-1 py-px text-3xs leading-none ring-2 ring-surface-50 dark:ring-surface-800"
									data-testid="checkpoint-badge"
									aria-label="{heldBadge.label} intercepted"
								>{heldBadge.label}</span>
							{/if}
						</div>
					</svelte:fragment>
					<span>Checkpoint</span>
				</AppRailAnchor>
				<AppRailAnchor
					regionLabel="!text-2xs !font-semibold leading-tight"
					selected={$page.url.pathname ===
						"/launchpad"}
					on:click={() => {
						goto("/launchpad");
					}}
					bind:group={currentTile}
					name="Launchpad"
					value={appRailIndex++}
					title="Launchpad"
				>
					<svelte:fragment slot="lead">
						<div
							class="flex justify-center items-center w-full"
						>
							<SendIcon size="20" />
						</div>
					</svelte:fragment>
					<span>Launchpad</span>
				</AppRailAnchor>
				<AppRailAnchor
					regionLabel="!text-2xs !font-semibold leading-tight"
					selected={$page.url.pathname ===
						"/armory"}
					on:click={() => {
						goto("/armory");
					}}
					bind:group={currentTile}
					name="Armory"
					value={appRailIndex++}
					title={runningBadge.title}
				>
					<svelte:fragment slot="lead">
						<div
							class="relative flex justify-center items-center w-full"
						>
							<Swords size="20" />
							{#if runningBadge.label}
								<span
									class="badge-icon variant-filled-primary pointer-events-none absolute left-1/2 -top-1.5 ml-1 h-auto min-w-[1.125rem] w-auto px-1 py-px text-3xs leading-none ring-2 ring-surface-50 dark:ring-surface-800"
									data-testid="armory-badge"
									aria-label="{runningBadge.label} running"
								>{runningBadge.label}</span>
							{/if}
						</div>
					</svelte:fragment>
					<span>Armory</span>
				</AppRailAnchor>

				<AppRailAnchor
					regionLabel="!text-2xs !font-semibold leading-tight"
					selected={$page.url.pathname ===
						"/logbook"}
					on:click={() => {
						goto("/logbook");
					}}
					bind:group={currentTile}
					name="Logbook"
					value={appRailIndex++}
					title="Logbook"
				>
					<svelte:fragment slot="lead">
						<div
							class="flex justify-center items-center w-full"
						>
							<BookOpenCheckIcon size="20" />
						</div>
					</svelte:fragment>
					<span>Logbook</span>
				</AppRailAnchor>
				<AppRailAnchor
					regionLabel="!text-2xs !font-semibold leading-tight"
					selected={$page.url.pathname ===
						"/workshop"}
					on:click={() => {
						goto("/workshop");
					}}
					bind:group={currentTile}
					name="Workshop"
					value={appRailIndex++}
					title="Workshop"
				>
					<svelte:fragment slot="lead">
						<div
							class="flex justify-center items-center w-full"
						>
							<ToolIcon size="20" />
						</div>
					</svelte:fragment>
					<span>Workshop</span>
				</AppRailAnchor>
				<AppRailAnchor
					regionLabel="!text-2xs !font-semibold leading-tight"
					selected={$page.url.pathname ===
						"/sveltechef"}
					on:click={async () => {
						await loadSvelteChef();
						goto("/sveltechef");
						showChef = true;
					}}
					bind:group={currentTile}
					name="Chef"
					value={appRailIndex++}
					title="Chef"
				>
					<svelte:fragment slot="lead">
						<div
							class="flex justify-center items-center w-full"
						>
							<ChefHat size="20" />
						</div>
					</svelte:fragment>
					<span>CyberChef</span>
				</AppRailAnchor>
				<AppRailAnchor
					regionLabel="!text-2xs !font-semibold leading-tight"
					selected={$page.url.pathname ===
						"/excalidraw"}
					on:click={async () => {
						await loadExcalidraw();
						goto("/excalidraw");
						showExcali = true;
					}}
					bind:group={currentTile}
					name="Excalidraw"
					value={appRailIndex++}
					title="Excalidraw"
				>
					<svelte:fragment slot="lead">
						<div
							class="flex justify-center items-center w-full"
						>
							<Brush size="20" />
						</div>
					</svelte:fragment>
					<span>Excalidraw</span>
				</AppRailAnchor>
				<AppRailAnchor
					regionLabel="!text-2xs !font-semibold leading-tight"
					selected={$page.url.pathname ===
						"/interact"}
					on:click={async () => {
						await loadInteract();
						goto("/interact");
						showInteract = true;
					}}
					bind:group={currentTile}
					name="InteractSh"
					value={appRailIndex++}
					title="InteractSh"
				>
					<svelte:fragment slot="lead">
						<div
							class="flex justify-center items-center w-full"
						>
							<ZapIcon size="20" />
						</div>
					</svelte:fragment>
					<span>Interactsh</span>
				</AppRailAnchor>
				{#each $extensions as extension}
					{@const iconSchema =
						$extensions_ui[extension.Name]
							?.icon}
					{#if iconSchema}
						<AppRailAnchor
							regionLabel="!text-2xs !font-semibold leading-tight"
							selected={$page.url
								.pathname ===
								"/extension/" +
									extension.Name}
							on:click={() => {
								goto(
									"/extension/" +
										extension.Name,
								);
							}}
							bind:group={currentTile}
							name={extension.Name}
							value={appRailIndex++}
							title={extension.Name}
						>
							<svelte:fragment
								slot="lead"
							>
								<div>
									<ExtensionUI
										extensionData={extension}
										schema={iconSchema}
									/>
								</div>
							</svelte:fragment>
							<span
								>{extension.Name}</span
							>
						</AppRailAnchor>
					{:else if extension.UICode}
						<AppRailAnchor
							regionLabel="!text-2xs !font-semibold leading-tight"
							selected={$page.url.pathname ===
								"/extension/" + extension.Name}
							on:click={() => goto("/extension/" + extension.Name)}
							bind:group={currentTile}
							name={extension.Name}
							value={appRailIndex++}
							title={extension.Name}
						>
							<svelte:fragment slot="lead">
								<div
									class="flex justify-center items-center w-full"
									data-testid="extension-web-ui-tile"
								>
									<WebComponent
										name={extension.Name}
										target="icon"
										code={extension.UICode}
										version={extension.Version}
									>
										<PuzzleIcon size="20" />
									</WebComponent>
								</div>
							</svelte:fragment>
							<span>{extension.Name}</span>
						</AppRailAnchor>
					{/if}
				{/each}
				<svelte:fragment slot="trail">
					<ConnectionRailTile />
					<div
						class="flex justify-center items-center w-full py-2"
					>
						<!-- On a phone the rail is 48pt wide: a smaller switch keeps
						     8pt either side of it. -->
						<LightSwitch
							width={$mobile ? "w-8" : "w-10"}
							height={$mobile ? "h-4" : "h-5"}
							bgLight="bg-surface-200"
							bgDark="bg-surface-500"
							fillLight="fill-surface-50"
							fillDark="fill-surface-50"
							ring="ring-[1px] ring-surface-400"
							class="outline-none focus:outline-none focus-visible:outline-none"
						/>
					</div>
					<!-- The Settings icon carries the update indicator: a dot for
					     an update waiting (green when available, red after a
					     failure, tertiary and pulsing for a restart), a ring filling with its download. While an
					     update waits, the icon opens Settings → Updates. -->
					<AppRailAnchor
						regionLabel="!text-2xs !font-semibold leading-tight"
						selected={$page.url.pathname ===
							"/settings"}
						on:click={() => {
							goto(settingsPath($updateState));
						}}
						bind:group={currentTile}
						name="Settings"
						value={appRailIndex++}
						title={settingsIndicator
							? `Settings · ${updateIndicatorLabel($updateState)}`
							: "Settings"}
					>
						<div
							class="relative flex justify-center items-center w-full"
						>
							<SettingsIcon size="20" />
							{#if settingsIndicator?.kind === "ring"}
								<svg
									class="pointer-events-none absolute h-8 w-8 -rotate-90 {settingsIndicator.spinning
										? 'animate-spin'
										: ''}"
									viewBox="0 0 40 40"
									aria-hidden="true"
								>
									<circle
										cx="20"
										cy="20"
										r={ringRadius}
										fill="none"
										stroke-width="3"
										class={settingsIndicator.spinning
											? "stroke-primary-500"
											: "stroke-surface-300 dark:stroke-surface-600"}
									/>
									<!-- Downloading: the arc is the progress. Verifying and
									     installing: the ring is full, and a brighter quarter
									     arc spins round it. -->
									<circle
										cx="20"
										cy="20"
										r={ringRadius}
										fill="none"
										stroke-width="3"
										stroke-linecap="round"
										class="{settingsIndicator.spinning
											? 'stroke-primary-200'
											: 'stroke-primary-500'} transition-all"
										stroke-dasharray={ringLength}
										stroke-dashoffset={settingsIndicator.spinning
											? ringLength * 0.75
											: ringLength *
												(1 -
													settingsIndicator.percent /
														100)}
									/>
								</svg>
							{:else if settingsIndicator?.kind === "dot"}
								<span
									class="pointer-events-none absolute right-4 -top-1 flex h-3 w-3"
									aria-hidden="true"
								>
									{#if settingsIndicator.pulse}
										<span
											class="absolute inline-flex h-full w-full animate-ping rounded-full {dotTones[settingsIndicator.tone].ping} opacity-75"
										></span>
									{/if}
									<span
										class="relative inline-flex h-3 w-3 rounded-full ring-2 ring-surface-50 dark:ring-surface-800 {dotTones[settingsIndicator.tone].dot}"
									></span>
								</span>
							{/if}
						</div>
					</AppRailAnchor>
				</svelte:fragment>
			</AppRail>

			<!-- Content area -->
			<div id="content" class="flex-1 overflow-auto">
				<div class="sticky top-0 z-20"><ConnectionBanner /></div>
				<!-- The service has another project open than the pages show, or
				     Marasi is stopped: they stay visible but read-only until the
				     banner's Load it or Start. -->
				<div
					class="contents"
					class:held-pages={pagesHeld($connectionStore.phase)}
					inert={pagesHeld($connectionStore.phase)}
					data-testid="pages"
				>
					{#key $pagesKey}
						<slot />
					{/key}
				</div>
				{#if SvelteChef && showChef}
					<svelte:component
						this={SvelteChef}
						isVisible={showChef}
					/>
				{/if}
				{#if Excalidraw && showExcali}
					<svelte:component
						this={Excalidraw}
						isVisible={showExcali}
					/>
				{/if}
				{#if Interact && showInteract}
					<svelte:component
						this={Interact}
						isVisible={showInteract}
					/>
				{/if}
			</div>
			{#if $mobile}
				<BottomBar primary={barPrimary} more={barMore} onConnections={openConnections} />
			{/if}
		{:else if !$opening}
			<div
				class="flex items-center w-full h-full justify-center"
			>
				<div class="flex flex-col items-center">
					<Logo
						size="128"
						mode={$modeCurrent ? "light" : "dark"}
					/>
					<p class="text-xs text-center" data-testid="connection-status">
						{startupText($connectionStore) ?? $appState.message}
					</p>
					{#if $connectionStore.phase === "failed" && outdatedVersion($connectionStore.error) !== null}
						<div class="mt-2 max-w-md">
							<OutdatedInstance error={$connectionStore.error} centred />
						</div>
					{:else if $connectionStore.phase === "failed"}
						<p class="mt-2 max-w-md text-xs text-center opacity-70 break-words">
							{$connectionStore.error}
						</p>
					{/if}
					{#if startupOffersConnections($connectionStore.phase)}
						<div class="mt-3 flex justify-center gap-2">
							{#if $connectionStore.phase === "failed" && outdatedVersion($connectionStore.error) === null}
								<button
									type="button"
									class="btn btn-sm {primaryVariant($modeCurrent)}"
									on:click={() => connectionStore.retry()}
								>
									Retry
								</button>
							{/if}
							<button
								type="button"
								class="btn btn-sm {neutralVariant($modeCurrent)}"
								data-testid="startup-connections"
								on:click={openConnections}
							>
								Connections…
							</button>
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</div>
</div>
{#if $appState.started}
	<AppDrawer />
{/if}
<!-- The opening screen covers the app rather than replacing it, so the open
     project's pages stay mounted, exactly as they were, if the open fails. -->
{#if $opening && $openingShown}
	<div class="fixed inset-0 z-[998] overflow-auto bg-surface-50-900-token safe-area-pad">
		<OpeningScreen
			state={$opening}
			browse={filePickerShown($connectionStore.connection)}
			on:stay={() => projectStore.stay()}
			on:retry={() => retryOpen(toastStore, modalStore)}
			on:open={(event) => openProjectFile({ path: event.detail }, toastStore, modalStore)}
			on:browse={() =>
				OpenFileDialog()
					.then((path) => {
						if (path) openProjectFile(path, toastStore, modalStore);
					})
					.catch((err) =>
						console.error("Opening the file dialog failed:", err),
					)}
		/>
	</div>
{/if}
<!-- Bottom-right toasts would cover the Keybindings modal's Save button;
     while it is open they show at the top, over its title. -->
<Toast
	position={$modalStore[0]?.component === "Keybindings" ? "t" : "br"}
	buttonAction={$modeCurrent
		? "btn variant-ghost-primary border-0 ring-0"
		: "btn variant-filled-primary"}
/>
<!-- The built-in confirm, alert and prompt dialogs take the type scale the
     component modals use: a text-base title, text-sm body and btn-sm buttons. -->
<Modal
	components={modalRegistery}
	background="bg-surface-50 dark:bg-surface-800 text-surface-900-50-token"
	spacing="space-y-3"
	regionHeader="text-base font-bold"
	regionBody="max-h-[200px] overflow-hidden text-sm"
	buttonPositive={$modeCurrent
		? "btn-sm variant-ghost-primary border-0 ring-0"
		: "btn-sm variant-filled-primary"}
	buttonNeutral={`btn-sm ${neutralVariant($modeCurrent)}`}
/>

<style>
	.held-pages > :global(*) {
		opacity: 0.6;
	}
	:global(.snackbar-wrapper) {
		z-index: 1000 !important;
	}
	:global(html:not(.dark) .modal-backdrop) {
		background-color: rgb(15 23 42 / 0.12) !important;
	}
	:global(html:not(.dark) .modal-backdrop .modal) {
		background-color: rgb(var(--color-surface-50)) !important;
		opacity: 1 !important;
	}
	:global(html:not(.dark) .modal-footer .variant-ghost),
	:global(html:not(.dark) .modal-footer .variant-ghost-primary) {
		border: 0 !important;
		box-shadow: none !important;
		--tw-ring-shadow: 0 0 #0000;
	}
	:global(html:not(.dark) .modal-prompt-input) {
		background-color: #ffffff !important;
		color: rgb(var(--color-surface-900)) !important;
		border: 0 !important;
		box-shadow: none !important;
	}
	:global(.dark .modal-prompt-input) {
		background-color: rgb(var(--color-surface-700)) !important;
	}
	/* The rail still scrolls when extension tiles overflow it, but without a
	   scrollbar: one would take its width from the tiles and clip labels. */
	:global(.nav-rail) {
		overflow-x: hidden;
		overflow-y: auto;
		scrollbar-width: none;
	}
	:global(.nav-rail::-webkit-scrollbar) {
		display: none;
	}

	/* The mobile layout (html.mobile, lib/platform.js). The selectors are
	   global, as app.css's shared mobile rules are, so they weigh the same
	   against Skeleton's and Tailwind's classes. */
	/* The mobile app rail: icons only, 48pt wide (the layout sets the width and a
	   smaller logo). Each tile keeps its name as its title. Settings draws its
	   icon in the label slot, so a label with an icon stays. */
	:global(html.mobile .nav-rail .app-rail-label:not(:has(svg))),
	:global(html.mobile .nav-rail .rail-label) {
		display: none;
	}
	/* The mobile frame: every page runs the full height, under the home
	   indicator too (the frame's bottom inset is dropped, and the body no
	   longer overflows the screen when a page, such as Compass, is taller).
	   Only the app rail's tiles move in, clear of the screen's curved corners,
	   as the drawer rail does when maximised. */
	:global(html.mobile .app-frame) {
		padding-bottom: 0;
	}
	:global(html.mobile .app-body) {
		height: auto;
		min-height: 0;
		overflow: hidden;
	}
	/* The inset is inside the first and last tiles, not around the rail, so
	   a selected Home or Settings tile fills to the screen's edge, its icon
	   clear of the curved corner. With the rail in view the frame drops its
	   top inset and the page takes it instead (pulling the rail up into the
	   frame's padding would be clipped by the body, as in portrait). */
	:global(html.mobile .app-frame:has(> .app-body > .nav-rail)) {
		padding-top: 0;
	}
	:global(html.mobile .app-frame:has(> .app-body > .nav-rail) #content) {
		margin-top: var(--safe-top);
	}
	:global(html.mobile .nav-rail .app-bar-default > .app-rail-anchor:first-child > .app-rail-wrapper) {
		padding-top: calc(0.625rem + max(var(--safe-top), 0.75rem));
	}
	:global(html.mobile .nav-rail .app-bar-trail > .app-rail-anchor:last-child > .app-rail-wrapper) {
		padding-bottom: calc(0.625rem + max(var(--safe-bottom), 1rem));
	}
	/* The mobile rail: a tap goes straight to the page, with no grey tap flash
	   and no hover tint left on the tile (a touch screen's hover sticks after
	   the tap). The selected tile keeps its colour. */
	:global(html.mobile .nav-rail),
	:global(html.mobile .nav-rail *) {
		-webkit-tap-highlight-color: transparent;
	}
	:global(html.mobile .nav-rail .bg-primary-hover-token:hover:not(.bg-primary-active-token)) {
		background-color: transparent;
	}
	@media (max-width: 40rem) {
		:global(html.mobile .nav-rail) {
			display: none;
		}
		:global(html.mobile .app-body) {
			flex-direction: column;
		}
		:global(html.mobile .app-body > #content) {
			min-height: 0;
			margin-left: var(--safe-left);
			margin-right: var(--safe-right);
		}
		:global(html.mobile .app-frame) {
			padding-left: 0;
			padding-right: 0;
		}
	}
</style>
