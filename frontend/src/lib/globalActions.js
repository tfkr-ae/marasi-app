// Operations shared by the global menu actions and the dashboard buttons.
import { goto } from "$app/navigation";
import { get } from "svelte/store";
import { DownloadCert, CopyCertToClipboard } from "./bindings/github.com/tfkr-ae/marasi-app/app.js";
import { setWindowTitle } from "./runtime.js";
import { checkpointHeldModal } from "./checkpointHeld.js";
import { appState } from "../stores.js";
import { homeStore } from "../stores/homeStore.js";
import { projectStore } from "../stores/projectStore.js";
import { projectTarget } from "../stores/projectApi.js";

// Starts or moves the service's proxy listener.
export function setupListener(r, toastStore) {
	homeStore
		.setListener(r.addr, r.port)
		.then(() => {
			toastStore.trigger({
				message: "Listening on " + r.addr + ":" + r.port,
				background: "variant-filled-success",
			});
		})
		.catch((err) => {
			console.error("Setting up the listener failed:", err);
			toastStore.trigger({
				message: "Failed to setup listener on " + r.addr + ":" + r.port,
				background: "variant-filled-error",
			});
		});
}

/**
 * Opens the project `r` (a path, or a name in the service's projects) on
 * the service and loads it (projectStore). The opening screen shows a slow
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
			if (r) setupListener(r, toastStore);
		},
	};
}

export async function downloadCertificate(toastStore) {
	try {
		const saved = await DownloadCert();
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
		const copied = await CopyCertToClipboard();
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

// chromeError returns a rejection handler for the Chrome bindings. They
// reread the machine config, so a config Marasi refuses (for example a
// negative websocket_max_message_size) arrives as its "invalid
// configuration" error, which is shown as is; anything else shows fallback.
export function chromeError(toastStore, fallback) {
	return (error) => {
		const text = String(error);
		toastStore.trigger({
			message: text.includes("invalid configuration") ? text : fallback,
			background: "variant-filled-error",
		});
	};
}
