<script>
	import Logo from "../lib/components/Logo.svelte";
	import OpeningScreen from "../lib/components/OpeningScreen.svelte";
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
		logItems,
		activeProject,
		listener,
		readConfig,
		marasiConfig,
		extensions,
		extensions_ui,
		appState,
		opening,
		openingShown,
		pagesKey,
		feedOpeningLog,
		loadedProject,
		stayInCurrentProject,
	} from "../stores.js";
	import {
		openProjectFile,
		openScratchpad,
		retryOpen,
	} from "../lib/globalActions.js";
	import { connectionStore } from "../stores/connectionStore";
	import { launchpadStore, reportUnsavedDrafts } from "../stores/launchpadStore";
	import {
		checkpointItemContext,
		checkpointStore,
	} from "../stores/checkpointStore";
	import { checkpointBadge } from "../lib/checkpointBadge.js";
	import { keyOf } from "../lib/checkpoint/itemContext.js";
	import { abandonLabel, abandonText } from "../lib/checkpoint/items.js";
	import { drawerKeybindingState, ledgerStore } from "../stores/ledgerStore";
	import { sitemapStore } from "../stores/sitemapStore";
	import { recentTraffic } from "../stores/recentTrafficStore";
	import { applyTextSize, textSize } from "../stores/textSizeStore.js";
	import {
		EventsOn,
		EventsOff,
		WindowSetTitle,
	} from "../lib/wailsjs/runtime/runtime";
	import AppDrawer from "../lib/components/AppDrawer.svelte";
	import NotesModal from "../lib/components/NotesModal.svelte";
	import RecordModal from "../lib/logbook/RecordModal.svelte";
	import SelectFindingModal from "../lib/components/SelectFindingModal.svelte";
	import SelectWordlistModal from "../lib/components/SelectWordlistModal.svelte";
	import {
		OpenFileDialog,
		StartProxy,
	} from "../lib/wailsjs/go/main/App";
	import {
		ChefHat,
		Brush,
		BookOpenCheckIcon,
		Swords,
	} from "lucide-svelte";
	import MenuModal from "../lib/components/MenuModal.svelte";
	import MetadataModal from "../lib/components/MetadataModal.svelte";
	import InterfaceModal from "../lib/components/InterfaceModal.svelte";
	import ProjectModal from "../lib/components/ProjectModal.svelte";
	import StartupStepper from "../lib/components/StartupStepper.svelte";
	import ExtensionUI from "../lib/extensions/ExtensionUI.svelte";
	import ModalWrapper from "../lib/extensions/components/ExtensionModalWrapper.svelte";
	import SelectTestCaseModal from "../lib/components/SelectTestCaseModal.svelte";
	import { isolateOverlays } from "../lib/overlayIsolation.js";
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
	// The Settings icon's update indicator (see settingsIconIndicator).
	$: settingsIndicator = settingsIconIndicator($updateState);
	// The Checkpoint icon's intercepted-count badge (see checkpointBadge).
	$: heldBadge = checkpointBadge($checkpointStore.items.length);
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
	};
	// Text size sizes the root element, so everything in rem follows it.
	// readConfig sets it before startup draws any text.
	$: applyTextSize($textSize);
	// Startup opens the scratchpad, and carries on once the first project
	// has opened and loaded: the scratchpad, or one picked on the opening
	// screen when the scratchpad can't open. It resolves to that project.
	let stopWaitingForProject = () => {};
	const StartupRoutine2 = new Promise((resolve) => {
		stopWaitingForProject = loadedProject.subscribe(
			(project) => project && resolve(project),
		);
		readConfig().then(openScratchpad);
	});
	// Starts the listener on the configured address.
	function startListener() {
		return StartProxy($marasiConfig.DefaultAddress, $marasiConfig.DefaultPort)
			.then(() => {
				listener.set({
					status: true,
					address: $marasiConfig.DefaultAddress,
					port: $marasiConfig.DefaultPort,
				});
			})
			.catch((listenerError) => {
				listener.set({
					status: false,
					address: $marasiConfig.DefaultAddress,
					port: $marasiConfig.DefaultPort,
				});
			});
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
	onMount(() => {
		const stopReportingDrafts = reportUnsavedDrafts();
		EventsOn("update-available", onUpdateAvailable);
		EventsOn("update-progress", onUpdateProgress);
		EventsOn("update-installed", onUpdateInstalled);
		EventsOn("update-failed", onUpdateFailed);
		refreshUpdateState();
		// The open in progress takes its steps from the backend's log events.
		EventsOn("log", feedOpeningLog);
		autoModeWatcher();
		StartupRoutine2.then((project) => {
			stopWaitingForProject();
			// The listener starts on the configured address, and the first-run
			// setup shows only once it has started (or failed to), as it sets
			// the listener up.
			startListener().then(() => {
				if (!$marasiConfig.FirstRun || $modalStore[0]) return;
				modalStore.trigger({
					type: "component",
					component: "Startup",
					title: "Setup Listener",
					response: (r) => {
						console.log(r);
					},
				});
			});
			// The project that opened, which may not be the scratchpad, names
			// the window and the app's project, as a switch does.
			WindowSetTitle(project.name);
			activeProject.set(project.name);
			appState.update((s) => ({ ...s, started: true, isReady: true }));
			removeMenuShortcuts = installMenuShortcuts(shortcutState);
			// The rail navigates by click, so nothing preloads the Ledger's
			// code on hover; load it now, so the first visit renders at once.
			preloadCode("/ledger").catch((err) =>
				console.error("Preloading the Ledger failed:", err),
			);

			function handleNewLog(newLog) {
				$logItems = [...$logItems, newLog];
			}
			function readCheckpointItems() {
				checkpointStore
					.onIntercepted()
					.catch((err) =>
						console.error(
							"Reading Checkpoint items failed:",
							err,
						),
					);
			}
			EventsOn("request", (newRequest) => {
				ledgerStore.onRequest(newRequest);
				sitemapStore.onRequest(newRequest);
				recentTraffic.onRequest(newRequest);
				launchpadStore.onRequest(newRequest);
			});
			EventsOn("launch-started", (launch) =>
				launchpadStore.onLaunchStarted(launch),
			);
			EventsOn("launch-finished", (launch) =>
				launchpadStore.onLaunchFinished(launch),
			);
			EventsOn("response", (newResponse) => {
				ledgerStore.onResponse(newResponse);
				sitemapStore.onResponse(newResponse);
				recentTraffic.onResponse(newResponse);
				launchpadStore.onResponse(newResponse);
				if (
					$drawerStore.id ===
						"request-response" &&
					$drawerStore.meta?.request?.ID ===
						newResponse.ID
				) {
					drawerStore.update((s) => {
						s.meta.incomingResponse =
							newResponse;
						return s;
					});
				}
			});
			EventsOn("ws-message", (msg) =>
				connectionStore.upsertMessage(msg),
			);
			EventsOn("ws-intercepted", (msg) => {
				connectionStore.upsertInterception(msg);
				readCheckpointItems();
			});
			EventsOn("ws-open", (conn) => {
				connectionStore.upsertConnection(conn);
				ledgerStore.patchWebSocketMetadata(conn);
			});
			EventsOn("ws-close", (conn) => {
				connectionStore.upsertConnection(conn);
				connectionStore.clearInterceptions(
					conn.RequestID,
				);
				ledgerStore.patchWebSocketMetadata(conn);
			});
			EventsOn("ws-progress", (progress) =>
				connectionStore.upsertProgress(progress),
			);
			// An upgrade whose handshake failed or was dropped opens no
			// connection, so only its Ledger row changes.
			EventsOn("ws-state", ({ RequestID, State }) =>
				ledgerStore.patchWebSocketMetadata({ RequestID, State }),
			);
			EventsOn("log", (newLog) => {
				if (typeof newLog?.Level !== "string") {
					return;
				}
				handleNewLog(newLog);
			});
			// Marasi dropped a held item because its client left. The
			// toast shows on any page.
			EventsOn("checkpoint-abandoned", (item) =>
				checkpointStore.onAbandoned(item),
			);
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
			// A held item was forwarded or dropped, on the Checkpoint page
			// or in the WebSocket modal; both drop it.
			EventsOn("checkpoint-settled", (item) => {
				readCheckpointItems();
				connectionStore
					.onSettled(item)
					.catch((err) =>
						console.error(
							"Reading WebSocket Checkpoint failed:",
							err,
						),
					);
			});
			// The Checkpoint rail badge shows the count; no toast.
			EventsOn("intercepted", () => readCheckpointItems());
			EventsOn(
				"extension_gui_render",
				({ extensionName, target, schema }) => {
					if (target === "toast") {
						const allowedVariants = [
							"primary",
							"secondary",
							"tertiary",
							"success",
							"warning",
							"error",
							"surface",
						];
						const variant =
							allowedVariants.includes(
								schema.variant,
							)
								? "variant-filled-" +
									schema.variant
								: "variant-filled-primary";
						const t = {
							message: schema.message,
							background: variant,
						};

						toastStore.trigger(t);
					} else {
						extensions_ui.update(
							(store) => {
								const ext =
									store[
										extensionName
									] || {
										state: {},
									};
								ext[target] =
									schema;
								return {
									...store,
									[extensionName]:
										ext,
								};
							},
						);
					}
				},
			);

			EventsOn(
				"extension_state_update",
				({ extensionName, key, value }) => {
					extensions_ui.update((store) => {
						const ext = store[
							extensionName
						] || { state: {} };
						ext.state[key] = value;
						return {
							...store,
							[extensionName]: ext,
						};
					});
					console.log($extensions_ui);
				},
			);
		});
		return () => {
			stopReportingDrafts();
			removeMenuShortcuts();
			EventsOff("request");
			EventsOff("response");
			EventsOff("ws-message");
			EventsOff("ws-intercepted");
			EventsOff("ws-open");
			EventsOff("ws-close");
			EventsOff("ws-progress");
			EventsOff("ws-state");
			EventsOff("intercepted");
			EventsOff("checkpoint-abandoned");
			EventsOff("checkpoint-settled");
			stopAbandonToasts?.();
			EventsOff("log");
			EventsOff("update-available");
			EventsOff("update-progress");
			EventsOff("update-installed");
			EventsOff("update-failed");
			EventsOff("extension_gui_render");
			EventsOff("extension_state_update");
		};
	});
</script>

<div
	class="flex flex-col h-screen"
	use:isolateOverlays={{ modalStore, drawerStore, toastStore, isModalToggle }}
>
	<div class="flex flex-1 h-screen">
		{#if $appState.started}
			<GlobalMenu />
			<AppRail
				class="no-select h-full nav-rail"
				background="bg-surface-50-800-token"
				aspectRatio="py-2.5 px-1.5"
				width="w-[76px]"
				spacing="space-y-0.5"
			>
				<!-- AppRailTiles -->
				<AppRailAnchor
					regionLabel="!text-[11px] !font-semibold leading-tight"
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
								size="52"
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
					regionLabel="!text-[11px] !font-semibold leading-tight"
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
					regionLabel="!text-[11px] !font-semibold leading-tight"
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
					regionLabel="!text-[11px] !font-semibold leading-tight"
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
									class="badge-icon variant-filled-primary pointer-events-none absolute left-1/2 -top-1.5 ml-1 h-auto min-w-[1.125rem] w-auto px-1 py-px text-[10px] leading-none ring-2 ring-surface-50 dark:ring-surface-800"
									data-testid="checkpoint-badge"
									aria-label="{heldBadge.label} intercepted"
								>{heldBadge.label}</span>
							{/if}
						</div>
					</svelte:fragment>
					<span>Checkpoint</span>
				</AppRailAnchor>
				<AppRailAnchor
					regionLabel="!text-[11px] !font-semibold leading-tight"
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
					regionLabel="!text-[11px] !font-semibold leading-tight"
					selected={$page.url.pathname ===
						"/armory"}
					on:click={() => {
						goto("/armory");
					}}
					bind:group={currentTile}
					name="Armory"
					value={appRailIndex++}
					title="Armory"
				>
					<svelte:fragment slot="lead">
						<div
							class="flex justify-center items-center w-full"
						>
							<Swords size="20" />
						</div>
					</svelte:fragment>
					<span>Armory</span>
				</AppRailAnchor>

				<AppRailAnchor
					regionLabel="!text-[11px] !font-semibold leading-tight"
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
					regionLabel="!text-[11px] !font-semibold leading-tight"
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
					regionLabel="!text-[11px] !font-semibold leading-tight"
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
					regionLabel="!text-[11px] !font-semibold leading-tight"
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
					regionLabel="!text-[11px] !font-semibold leading-tight"
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
							regionLabel="!text-[11px] !font-semibold leading-tight"
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
					{/if}
				{/each}
				<svelte:fragment slot="trail">
					<div
						class="flex justify-center items-center w-full py-2"
					>
						<LightSwitch
							width="w-10"
							height="h-5"
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
						regionLabel="!text-[11px] !font-semibold leading-tight"
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
				{#key $pagesKey}
					<slot />
				{/key}
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
		{:else if !$opening}
			<div
				class="flex items-center w-full h-full justify-center"
			>
				<div class="items-center justify-center">
					<Logo
						size="128"
						mode={$modeCurrent ? "light" : "dark"}
					/>
					<p class="text-xs">
						{$appState.message}
					</p>
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
	<div class="fixed inset-0 z-[998] overflow-auto bg-surface-50-900-token">
		<OpeningScreen
			state={$opening}
			on:stay={stayInCurrentProject}
			on:retry={retryOpen}
			on:open={(event) => openProjectFile(event.detail, toastStore, modalStore)}
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
	buttonNeutral={$modeCurrent
		? "btn-sm variant-ghost-surface border-0 ring-0"
		: "btn-sm variant-ghost-surface"}
/>

<style>
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
	:global(html:not(.dark) .modal-footer .variant-ghost-surface),
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
</style>
