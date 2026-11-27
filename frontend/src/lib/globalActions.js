// Operations shared by the global menu actions and the dashboard buttons.
import { chromeErrorText } from "./startChrome.js";
import { goto } from "$app/navigation";
import { get } from "svelte/store";
import { SaveFileAs, CopyCertToClipboard } from "./bindings/github.com/tfkr-ae/marasi-app/app.js";
import { createCertificateActions } from "./certificate.js";
import { listenerStart } from "./listenerInterfaces.js";
import { service } from "./service/index.js";
import { isSuperseded } from "./service/errors.js";
import { setWindowTitle } from "./runtime.js";
import { checkpointHeldModal } from "./checkpointHeld.js";
import { appState, marasiConfig } from "../stores.js";
import { homeStore } from "../stores/homeStore.js";
import { projectStore } from "../stores/projectStore.js";
import { projectTarget } from "../stores/projectApi.js";

// Starts or moves the service's proxy listener. The app's default port falls
// back to a free one when it is taken, as the app's instance does.
export function setupListener(r, toastStore) {
	const fallback = String(r.port) === String(get(marasiConfig).DefaultPort || "8080");
	return homeStore
		.setListener(r.addr, r.port, { fallback })
		.then((listener) => {
			toastStore.trigger({
				message: "Listening on " + listener.address + ":" + listener.port,
				background: "variant-filled-success",
			});
			return listener;
		})
		.catch((err) => {
			if (isSuperseded(err)) return null;
			console.error("Setting up the listener failed:", err);
			toastStore.trigger({
				message: "Failed to setup listener on " + r.addr + ":" + r.port,
				background: "variant-filled-error",
			});
			return null;
		});
}

// Stops the service's proxy listener without stopping the service.
export function stopListener(toastStore) {
	return homeStore
		.stopListener()
		.then((listener) => {
			toastStore.trigger({
				message: "Listener stopped",
				background: "variant-filled-success",
			});
			return listener;
		})
		.catch((err) => {
			if (isSuperseded(err)) return null;
			console.error("Stopping the listener failed:", err);
			toastStore.trigger({
				message: "Failed to stop listener",
				background: "variant-filled-error",
			});
			return null;
		});
}

// Starts the service's proxy listener on its last active address and port,
// or the app's default listener when none has run in this session.
export function startListener(toastStore) {
	const state = get(homeStore);
	const target = listenerStart(state.listener, get(marasiConfig), state.lastListener);
	return setupListener({ addr: target.address, port: target.port }, toastStore);
}

// Stops the proxy listener while active, or starts it again while off.
export function toggleListener(toastStore) {
	const state = get(homeStore);
	if (state.listenerBusy) return Promise.resolve(null);
	return state.listener.status ? stopListener(toastStore) : startListener(toastStore);
}

/**
 * Opens the project `r` (a listed project's `{path}`, or typed text: a
 * path or a name in the service's projects; see projectTarget) on the
 * service and loads it (projectStore). The opening screen shows a slow
 * or failed open; a toastStore announces the open, and a modalStore shows
 * a refusal over held Checkpoint items. Resolves to the project that
 * opened, `{name, path}`, or null.
 */
export function openProjectFile(r, toastStore, modalStore) {
	return settle(projectStore.open(projectTarget(r)), toastStore, modalStore);
}

/** Re-runs the last open, for the opening screen's Try again. */
export function retryOpen(toastStore, modalStore) {
	return settle(projectStore.retry(), toastStore, modalStore);
}

// Shows what an open ended in.
async function settle(opening, toastStore, modalStore) {
	appState.update((s) => ({ ...s, isReady: false }));
	try {
		const result = await opening;
		if (result?.status === "held") modalStore?.trigger(heldModal());
		if (result?.status !== "opened") return null;
		setWindowTitle(result.project.name);
		goto("/");
		toastStore?.trigger({
			message: "Opened " + result.project.name + " project",
			background: "variant-filled-success",
		});
		return result.project;
	} catch (err) {
		if (!isSuperseded(err)) {
			console.error("Opening project failed:", err);
			toastStore?.trigger({
				message: "Couldn't open project: " + (err?.message ?? err),
				background: "variant-filled-error",
			});
		}
		return null;
	} finally {
		appState.update((s) => ({ ...s, isReady: true }));
	}
}

// The refusal over held Checkpoint items, which ⌘O closes again.
const heldModal = () => ({
	...checkpointHeldModal(() => goto("/checkpoint")),
	toggleAction: "global.open-project",
});

/**
 * Opens the project picker, or, while Checkpoint holds items, the refusal
 * the switch would end in.
 */
export async function openProjectPicker(toastStore, modalStore) {
	const held = await projectStore.held().catch(() => []);
	if (get(modalStore)[0]) return;
	modalStore.trigger(held?.length ? heldModal() : projectModal(toastStore, modalStore));
}

export function projectModal(toastStore, modalStore) {
	return {
		type: "component",
		component: "Project",
		toggleAction: "global.open-project",
		title: "Switch Projects",
		response: (r) => {
			if (r) openProjectFile(r, toastStore, modalStore);
		},
	};
}

export function listenerModal(toastStore) {
	return {
		type: "component",
		component: "Interface",
		toggleAction: "global.setup-listener",
		title: "Setup Listener",
		response: (r) => {
			if (!r) return;
			if (r.action === "stop") stopListener(toastStore);
			else setupListener(r, toastStore);
		},
	};
}

const certificate = createCertificateActions({
	client: service,
	saveFileAs: SaveFileAs,
	copyCertToClipboard: CopyCertToClipboard,
});

export async function downloadCertificate(toastStore) {
	try {
		const saved = await certificate.download();
		if (saved) {
			toastStore.trigger({
				message: "Certificate saved successfully",
				background: "variant-filled-success",
			});
		}
	} catch (err) {
		toastStore.trigger({
			message: "Failed to save certificate: " + err,
			background: "variant-filled-error",
		});
	}
}

export async function copyCertificate(toastStore) {
	try {
		const copied = await certificate.copy();
		if (copied) {
			toastStore.trigger({
				message: "Certificate copied to clipboard",
				background: "variant-filled-success",
			});
		}
	} catch (err) {
		toastStore.trigger({
			message: "Failed to copy certificate: " + err,
			background: "variant-filled-error",
		});
	}
}

// chromeError returns a rejection handler for the Chrome calls, toasting
// why Chrome didn't start, or fallback (chromeErrorText).
export function chromeError(toastStore, fallback) {
	return (error) => {
		toastStore.trigger({
			message: chromeErrorText(error, fallback),
			background: "variant-filled-error",
		});
	};
}
