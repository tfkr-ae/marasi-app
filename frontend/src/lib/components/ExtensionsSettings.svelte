<script>
	// Settings → Extensions: the project's extensions, each turned on or off
	// and its settings (a JSON object) edited in place. Lists follow
	// extension.enabled and the settings follow extension.settings.updated.
	import { getToastStore, modeCurrent, SlideToggle } from "@skeletonlabs/skeleton";
	import { extensionsStore, parseSettings } from "../../stores/extensionsStore.js";
	import { toastError } from "../toasts.js";
	import { primaryVariant } from "../launchpad/format.js";

	const toastStore = getToastStore();
	const { list, settings } = extensionsStore;
	export let row = "";
	export let control = "";

	$: primary = primaryVariant($modeCurrent);
	// The extension whose settings are open, its text, and why it was refused.
	let editing = null;
	let draft = "";
	let draftError = "";

	function setEnabled(extension, enabled) {
		extensionsStore
			.setEnabled(extension.ID, enabled)
			.catch((error) => toastError(toastStore, `Error turning ${extension.Name} ${enabled ? "on" : "off"}`, error));
	}

	async function openSettings(extension) {
		if (editing === extension.ID) {
			editing = null;
			return;
		}
		try {
			await extensionsStore.loadSettings(extension.ID);
			shown = null;
			draftError = "";
			editing = extension.ID;
		} catch (error) {
			toastError(toastStore, `Error reading ${extension.Name} settings`, error);
		}
	}

	async function saveSettings(extension) {
		const parsed = parseSettings(draft);
		draftError = parsed.error ?? "";
		if (parsed.error) return;
		try {
			await extensionsStore.saveSettings(extension.ID, parsed.settings);
			toastStore.trigger({ message: `Saved ${extension.Name} settings`, background: "variant-filled-success" });
		} catch (error) {
			toastError(toastStore, `Error saving ${extension.Name} settings`, error);
		}
	}

	// Settings read or changed by another client show in the open editor;
	// only a new settings object replaces what is being typed.
	let shown = null;
	$: if (editing) showSettings($settings[editing]);
	function showSettings(read) {
		if (!read || read === shown) return;
		shown = read;
		draft = JSON.stringify(read, null, 2);
	}
</script>

<h3 class="text-sm font-bold">Extensions</h3>
{#each $list as extension (extension.ID)}
	<div data-extension={extension.Name}>
		<div class={row}>
			<div class="min-w-0">
				<p>{extension.Name}</p>
				<p class="text-xs opacity-70">{extension.Description || extension.Author || ""}</p>
			</div>
			<div class="{control} items-center justify-end gap-3">
				<button
					type="button"
					class="btn btn-sm {primary}"
					aria-expanded={editing === extension.ID}
					on:click={() => openSettings(extension)}>Settings</button
				>
				<SlideToggle
					name="extension-enabled-{extension.Name}"
					label="{extension.Name} enabled"
					active="bg-primary-500"
					checked={extension.Enabled}
					on:change={(event) => setEnabled(extension, event.currentTarget.checked)}
				/>
			</div>
		</div>
		{#if editing === extension.ID}
			<div class="py-3" data-testid="extension-settings-editor">
				<textarea
					class="textarea w-full font-mono text-xs bg-white dark:bg-surface-700"
					rows="8"
					spellcheck="false"
					aria-label="{extension.Name} settings"
					bind:value={draft}
				/>
				{#if draftError}
					<p class="mt-1 text-xs text-error-500" role="alert">{draftError}</p>
				{/if}
				<div class="mt-2 flex justify-end">
					<button type="button" class="btn btn-sm {primary}" on:click={() => saveSettings(extension)}
						>Save</button
					>
				</div>
			</div>
		{/if}
	</div>
{:else}
	<p class="py-3 text-xs opacity-70">No extensions</p>
{/each}
