<script>
	// Home: the project name with the capture controls, then the Overview's
	// figures (lib/home/overview.js), each opening the page it counts.
	import { GetChromeProfiles } from "../lib/bindings/github.com/tfkr-ae/marasi-app/app.js";
	import { startChrome as startChromeOn } from "../lib/chrome.js";
	import { getDrawerStore, getModalStore, getToastStore } from "@skeletonlabs/skeleton";
	import { activeProject } from "../stores";
	import { homeStore } from "../stores/homeStore";
	import {
		chromeError,
		downloadCertificate,
		listenerModal,
		openProjectPicker,
		toggleListener,
	} from "../lib/globalActions.js";
	import { onMount } from "svelte";
	import { get } from "svelte/store";
	import { followChromeConfig } from "../lib/chromeConfigEvents.js";
	import { service } from "../lib/service/index.js";
	import { connectionStore } from "../stores/connectionStore.js";
	import { mobile, mobileCheck } from "../lib/platform.js";
	import CaptureControls from "../lib/home/CaptureControls.svelte";
	import FigureGrid from "../lib/home/FigureGrid.svelte";
	import { openDestination, overview } from "../lib/home/homeOverview.js";
	import { toggleServiceLog } from "../lib/serviceLog.js";
	const drawerStore = getDrawerStore();
	const modalStore = getModalStore();
	const toastStore = getToastStore();
	let chromeProfiles = [];

	const readChromeProfiles = () =>
		GetChromeProfiles()
			.then((profiles) => {
				chromeProfiles = profiles;
			})
			.catch(chromeError(toastStore, "Error reading Chrome profiles"));

	onMount(() => {
		// Home reads the counts and scope again each time it shows, keeping
		// the last figures meanwhile.
		homeStore.refreshDashboard();
		// The iOS app has no Chrome to start.
		mobileCheck.then((onMobile) => onMobile || readChromeProfiles());
		return followChromeConfig(service.on, {
			connectionKind: () => get(connectionStore).connection.kind,
			onPaths: () => {},
			onProfiles: readChromeProfiles,
		});
	});
	const startChrome = (profile) =>
		startChromeOn(profile).catch(chromeError(toastStore, "Error starting Chrome"));
</script>

<div class="home no-select" class:mobile-home={$mobile} data-testid="home-overview">
	<div class="container mx-auto p-4 pb-8 text-xs">
		<div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 mb-5">
			<div class="min-w-0">
				<p class="text-2xs opacity-60">Project</p>
				<h2 class="text-base font-bold truncate" data-testid="home-project">{$activeProject || "—"}</h2>
			</div>
			<CaptureControls
				listener={$homeStore.listener}
				listenerBusy={$homeStore.listenerBusy}
				{chromeProfiles}
				mobile={$mobile}
				on:editListener={() => {
					if (!$modalStore[0]) modalStore.trigger(listenerModal(toastStore));
				}}
				on:toggleListener={() => toggleListener(toastStore)}
				on:openProject={() => {
					if (!$modalStore[0]) openProjectPicker(toastStore, modalStore);
				}}
				on:downloadCertificate={() => downloadCertificate(toastStore)}
				on:startChrome={(e) => startChrome(e.detail)}
				on:openServiceLog={() => toggleServiceLog(drawerStore, $drawerStore)}
			/>
		</div>
		<FigureGrid figures={$overview.figures} on:open={(e) => openDestination(e.detail)} />
	</div>
</div>

<style>
	.home {
		height: 100vh;
		overflow-y: auto;
	}
	/* The phone app: the page scrolls inside the frame, above the bottom bar,
	   full width so its edges line up with the connection banner's (px-4). */
	.home.mobile-home {
		height: 100%;
	}
	.mobile-home .container {
		max-width: none;
	}
</style>
