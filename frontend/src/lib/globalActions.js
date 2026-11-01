// Operations shared by the global menu actions and the dashboard buttons.
import { get } from "svelte/store";
import { DownloadCert, CopyCertToClipboard } from "./bindings/App";
import { listener } from "../stores.js";
import { projectSwitch } from "../stores/projectSwitchStore.js";
import { codeIDs } from "./errorCodes.js";

// Listens on the modal's address and port, starting the listener or moving
// it; the listener store follows what Marasi answers.
export function setupListener(r, toastStore) {
	listener
		.setup(r.addr, r.port)
		.then(() => {
			toastStore.trigger({
				message: "Listening on " + r.addr + ":" + r.port,
				background: "variant-filled-success",
			});
		})
		.catch(() => {
			toastStore.trigger({
				message: "Failed to setup listener on " + r.addr + ":" + r.port,
				background: "variant-filled-error",
			});
		});
}

// Stops the listener, from the Setup Listener modal.
export function stopListener(toastStore) {
	listener
		.stop()
		.then(() => toastStore.trigger({ message: "Listener stopped" }))
		.catch((err) =>
			toastStore.trigger({
				message: "Failed to stop listener: " + err,
				background: "variant-filled-error",
			}),
		);
}

/**
 * Opens project `r` on the connected instance: a bare name in its projects
 * directory, or a path on the instance machine. The instance waits for
 * held Checkpoint items first. The opening screen shows a slow switch and
 * any failure (stores/createProjectSwitchStore.js), and the window's pages
 * stay as they were unless the project opens. Resolves to the project that
 * opened, `{name, path}`, or null.
 */
export async function openProjectFile(r, toastStore) {
	const opened = await projectSwitch.open(r);
	if (opened) {
		toastStore?.trigger({
			message: "Opened " + opened.name + " project",
			background: "variant-filled-success",
		});
	}
	return opened;
}

/**
 * Loads the project the connected instance has open, at startup, with the
 * opening screen up from the start. `status` is the instance's
 * /service/status. Resolves like openProjectFile.
 */
export function openConnectedProject(status) {
	return projectSwitch.openConnected(status);
}

/** Re-runs the last open, for the opening screen's Try again. */
export function retryOpen() {
	projectSwitch.retry();
}

/** Opens the project picker. */
export function openProjectPicker(toastStore, modalStore) {
	if (get(modalStore)[0]) return;
	modalStore.trigger(projectModal(toastStore));
}

export function projectModal(toastStore) {
	return {
		type: "component",
		component: "Project",
		toggleAction: "global.open-project",
		title: "Switch Projects",
		response: (r) => {
			if (r) openProjectFile(r, toastStore);
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
			if (r?.stop) stopListener(toastStore);
			else if (r) setupListener(r, toastStore);
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

// chromeError returns a rejection handler for the Chrome bindings. A
// listener that is off is said so, since Chrome would have no proxy;
// anything else shows fallback.
export function chromeError(toastStore, fallback) {
	return (error) => {
		toastStore.trigger({
			message: codeIDs(error, "listener_inactive") ? "Proxy listener is off" : fallback,
			background: "variant-filled-error",
		});
	};
}
