// Operations shared by the global menu actions and the dashboard buttons.
import { goto } from "$app/navigation";
import { get } from "svelte/store";
import {
	OpenProject,
	StartProxy,
	UpdateProxy,
	DownloadCert,
	CopyCertToClipboard,
} from "./wailsjs/go/main/App";
import { WindowSetTitle } from "./wailsjs/runtime/runtime";
import { activeProject, appState, listener, openProject } from "../stores.js";

export function setupListener(r, toastStore) {
	const active = get(listener).status;
	const apply = active ? UpdateProxy : StartProxy;
	apply(r.addr, r.port)
		.then(() => {
			listener.set({
				status: true,
				address: r.addr,
				port: r.port,
			});
			toastStore.trigger({
				message: "Listening on " + r.addr + ":" + r.port,
				background: "variant-filled-success",
			});
		})
		.catch(() => {
			if (!active) {
				listener.set({
					status: false,
					address: r.addr,
					port: r.port,
				});
			}
			toastStore.trigger({
				message: "Failed to setup listener on " + r.addr + ":" + r.port,
				background: "variant-filled-error",
			});
		});
}

export async function openProjectFile(r, toastStore) {
	// Show the splash only if OpenProject is slow, as when it migrates an
	// older project, so quick switches stay instant. Database log events
	// replace this message while it runs (see projectOpenMessage).
	const projectName = String(r)
		.split(/[\\/]/)
		.pop()
		.replace(/\.marasi$/, "");
	appState.update((s) => ({
		...s,
		message: "Opening " + projectName + "…",
		details: "",
	}));
	const splashTimer = setTimeout(
		() => appState.update((s) => ({ ...s, isReady: false })),
		300,
	);
	try {
		const name = await OpenProject(r).finally(() =>
			clearTimeout(splashTimer),
		);
		appState.update((s) => ({ ...s, isReady: false }));
		activeProject.set(name);
		WindowSetTitle(name);
		goto("/");
		await openProject();
		appState.update((s) => ({ ...s, isReady: true }));
		toastStore.trigger({
			message: "Opened " + name + " project",
			background: "variant-filled-success",
		});
	} catch (repoError) {
		appState.update((s) => ({ ...s, isReady: true }));
		if (String(repoError).includes("project switch cancelled")) return;
		toastStore.trigger({
			message: "Failed to open project",
			background: "variant-filled-error",
		});
	}
}

export function projectModal(toastStore) {
	return {
		type: "component",
		component: "Project",
		toggleShortcut: { key: "o" },
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
		toggleShortcut: { key: "l" },
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
