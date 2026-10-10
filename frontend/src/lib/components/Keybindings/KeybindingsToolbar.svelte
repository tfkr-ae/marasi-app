<script>
	// The two toolbar fields: Profile (select plus its Manage menu) and
	// Platform (select plus Reset for that platform). Choosing a profile or
	// platform only changes what the modal edits; it never activates a
	// profile or changes this device's dispatch. Every Manage entry and Reset
	// is a draft edit (onEdit) that only Save persists, except Export, which
	// writes the selected profile to a file (docs/keybinding-profile-format.md).
	import { getToastStore, modeCurrent } from "@skeletonlabs/skeleton";
	import { CheckCircle2, ChevronDown, Copy, Download, Pencil, Plus, RotateCcw, Trash2, Upload } from "lucide-svelte";
	import { ExportKeybindingProfile, ImportKeybindingProfile } from "../../wailsjs/go/main/App";
	import { PLATFORM_NAMES as platformNames } from "../../keybindings/platform.js";
	import { exportBlocker, exportFileName, exportProfile, importProfile } from "../../keybindings/portable.js";
	import {
		createProfile,
		deleteBlocker,
		deleteProfile,
		duplicateProfile,
		isPlatformCustomized,
		makeActive,
		makeActiveBlocker,
		profileNameProblem,
		renameProfile,
		resetPlatform,
		suggestProfileName,
	} from "../../keybindings/settings.js";
	import ModalCard from "./ModalCard.svelte";

	export let catalog;
	export let draft;
	export let profileId;
	export let platform;
	export let devicePlatform;
	export let onEdit; // (next draft) => void
	export let onConfirm; // ({ title, body, label, run }) => void: the modal's confirmation card
	// True while the Manage menu or the name card is open, so a backdrop
	// click dismisses that instead of closing the modal.
	export let pending = false;

	const inputClass = "bg-white dark:bg-surface-700 border-0 ring-0 focus:border-0 focus:ring-0";
	const sideButton = "btn h-10 shrink-0 variant-soft-primary !border-0 !ring-0";

	const toastStore = getToastStore();

	let menuOpen = false;
	let naming = null; // { title, label, value, profileId?, apply(name) }
	let notice = null; // { title, body }: why an import or export failed

	$: pending = menuOpen || Boolean(naming) || Boolean(notice);
	$: profile = draft.profiles.find((p) => p.id === profileId) ?? draft.profiles[0];
	$: variant = { profileId: profile.id, platform };
	$: canResetPlatform = isPlatformCustomized(catalog, draft, variant);
	$: nameProblem = naming ? profileNameProblem(draft, naming.value, naming.profileId) : "";
	$: activeBlocker = makeActiveBlocker(draft, profile.id);
	$: deleteReason = deleteBlocker(draft, profile.id);
	$: exportReason = exportBlocker(catalog, draft, profile.id);
	$: entries = [
		{ label: "Make Active", icon: CheckCircle2, disabled: Boolean(activeBlocker), title: activeBlocker || `Use ${profile.name} once you save`, run: activate },
		{ label: "Rename", icon: Pencil, title: `Rename ${profile.name}`, run: startRename },
		"divider",
		{ label: "New Profile", icon: Plus, title: "Start a profile from factory defaults", run: startCreate },
		{ label: "Duplicate", icon: Copy, title: `Copy ${profile.name} with both platforms`, run: startDuplicate },
		{ label: "Import", icon: Upload, title: "Add a profile from a file", run: startImport },
		{ label: "Export", icon: Download, disabled: Boolean(exportReason), title: exportReason || `Save ${profile.name} with both platforms to a file`, run: startExport },
		"divider",
		{ label: "Delete", icon: Trash2, danger: true, disabled: Boolean(deleteReason), title: deleteReason || `Delete ${profile.name}`, run: confirmDelete },
	];

	// Escape and backdrop clicks: the Manage menu, then the name card or the
	// import/export notice, give way before anything else. Returns whether
	// something was dismissed.
	export function dismiss() {
		if (menuOpen) menuOpen = false;
		else if (naming) naming = null;
		else if (notice) notice = null;
		else return false;
		return true;
	}

	const fileName = (path) => path.split(/[\\/]/).pop();

	// The file is read whole and validated before the draft changes; a bad
	// file leaves everything as it was. The imported profile is selected for
	// editing, never made active, and kept only by Save.
	async function startImport() {
		let file;
		try {
			file = await ImportKeybindingProfile();
		} catch (error) {
			notice = { title: "Profile not imported", body: String(error) };
			return;
		}
		if (!file.path) return;
		let result;
		try {
			result = importProfile(catalog, draft, file.contents);
		} catch (error) {
			notice = { title: "Profile not imported", body: `${fileName(file.path)}: ${error.message}` };
			return;
		}
		onEdit(result.draft);
		profileId = result.profileId;
		toastStore.trigger({
			message: `Imported ${result.name}. It is not active; save to keep it.`,
			background: "variant-filled-success",
		});
	}

	// Exports the profile as the modal shows it, unsaved edits included.
	async function startExport() {
		const source = profile;
		try {
			const path = await ExportKeybindingProfile(exportFileName(source), exportProfile(source));
			if (path) toastStore.trigger({ message: `Exported ${source.name} to ${fileName(path)}`, background: "variant-filled-success" });
		} catch (error) {
			notice = { title: "Profile not exported", body: String(error) };
		}
	}

	function activate() {
		onEdit(makeActive(draft, profile.id));
	}

	function startRename() {
		naming = {
			title: `Rename ${profile.name}`,
			label: "Rename",
			value: profile.name,
			profileId: profile.id,
			apply: (name) => renameProfile(draft, profile.id, name),
		};
	}

	function startCreate() {
		naming = {
			title: "New profile",
			label: "Create",
			value: suggestProfileName(draft, "Profile"),
			apply: (name) => createProfile(catalog, draft, name),
		};
	}

	function startDuplicate() {
		const source = profile;
		naming = {
			title: `Duplicate ${source.name}`,
			label: "Duplicate",
			value: suggestProfileName(draft, `${source.name} Copy`),
			apply: (name) => duplicateProfile(draft, source.id, name),
		};
	}

	function submitName() {
		if (nameProblem) return;
		const next = naming.apply(naming.value);
		const created = !naming.profileId;
		naming = null;
		onEdit(next);
		// A new profile is selected for editing; it is not made active.
		if (created) profileId = next.profiles.at(-1).id;
	}

	function confirmDelete() {
		const doomed = profile;
		onConfirm({
			title: `Delete ${doomed.name}?`,
			body: `${doomed.name} and its macOS and Windows / Linux bindings are removed when you save.`,
			label: "Delete",
			run: () => {
				const next = deleteProfile(draft, doomed.id);
				profileId = next.activeProfile;
				onEdit(next);
			},
		});
	}

	function confirmResetPlatform() {
		const name = platformNames[platform];
		const at = variant;
		onConfirm({
			title: `Reset ${name} bindings?`,
			body: `Every action in ${profile.name} returns to its ${name} default. The other platform is unchanged.`,
			label: "Reset",
			run: () => onEdit(resetPlatform(catalog, draft, at)),
		});
	}

	function focus(node) {
		node.focus();
		node.select();
	}
</script>

<div class="grid grid-cols-2 gap-4">
	<div class="label">
		<span id="keybindings-profile-label">Profile</span>
		<div class="relative flex">
			<select class="select {inputClass}" aria-labelledby="keybindings-profile-label" bind:value={profileId}>
				{#each draft.profiles as item (item.id)}
					<option value={item.id}>{item.name}{item.id === draft.activeProfile ? " (Active)" : ""}</option>
				{/each}
			</select>
			<button
				type="button"
				class={sideButton}
				aria-haspopup="menu"
				aria-expanded={menuOpen}
				on:click={() => (menuOpen = !menuOpen)}
			>
				Manage <ChevronDown size={16} class="ml-1" />
			</button>
			{#if menuOpen}
				<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
				<div class="fixed inset-0 z-10" on:click={() => (menuOpen = false)}></div>
				<ul
					class="absolute right-0 top-full z-20 mt-1 w-56 border-t-4 border-primary-500 py-1 shadow-xl bg-surface-50 dark:bg-surface-800"
					role="menu"
					aria-label="Manage profiles"
					data-profile-menu
				>
					{#each entries as entry}
						{#if entry === "divider"}
							<li class="my-1 border-t border-surface-300 dark:border-surface-600" role="separator"></li>
						{:else}
							<li role="none">
								<button
									type="button"
									class="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-primary-200 disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-primary-500 {entry.danger
										? 'text-error-600 dark:text-error-400 dark:hover:text-black'
										: ''}"
									role="menuitem"
									disabled={entry.disabled}
									title={entry.title}
									on:click={() => {
										menuOpen = false;
										entry.run();
									}}><svelte:component this={entry.icon} size={16} /> {entry.label}</button
								>
							</li>
						{/if}
					{/each}
				</ul>
			{/if}
		</div>
	</div>
	<label class="label">
		<span>Platform</span>
		<div class="flex">
			<select class="select {inputClass}" bind:value={platform}>
				{#each Object.entries(platformNames) as [id, name]}
					<option value={id}>{name}{id === devicePlatform ? " (This device)" : ""}</option>
				{/each}
			</select>
			<button
				type="button"
				class={sideButton}
				disabled={!canResetPlatform}
				title={canResetPlatform
					? `Reset every ${platformNames[platform]} binding in ${profile.name}`
					: `Every ${platformNames[platform]} binding in ${profile.name} is already the default`}
				on:click={confirmResetPlatform}
			>
				<RotateCcw size={16} class="mr-1" /> Reset
			</button>
		</div>
	</label>
</div>

{#if naming}
	<ModalCard title={naming.title} data-profile-name>
		<form id="keybindings-profile-name" class="space-y-2" on:submit|preventDefault={submitName}>
			<label class="label">
				<span>Name</span>
				<input
					class="input {inputClass}"
					type="text"
					bind:value={naming.value}
					use:focus
					on:keydown={(event) => {
						// Submit on Enter without relying on implicit form submission.
						if (event.key !== "Enter" || event.isComposing) return;
						event.preventDefault();
						submitName();
					}}
				/>
			</label>
			{#if nameProblem}
				<p class="text-sm text-error-600 dark:text-error-400">{nameProblem}</p>
			{/if}
		</form>
		<svelte:fragment slot="footer">
			<button type="button" class="btn variant-ghost-surface" on:click={() => (naming = null)}>Cancel</button>
			<button
				type="submit"
				form="keybindings-profile-name"
				class="btn {$modeCurrent ? 'variant-ghost-primary border-0 ring-0' : 'variant-filled-primary'}"
				disabled={Boolean(nameProblem)}>{naming.label}</button
			>
		</svelte:fragment>
	</ModalCard>
{/if}

{#if notice}
	<ModalCard title={notice.title} data-profile-notice>
		<p class="break-words">{notice.body}</p>
		<p class="text-sm opacity-70">Your profiles are unchanged.</p>
		<svelte:fragment slot="footer">
			<button
				type="button"
				class="btn {$modeCurrent ? 'variant-ghost-primary border-0 ring-0' : 'variant-filled-primary'}"
				on:click={() => (notice = null)}>OK</button
			>
		</svelte:fragment>
	</ModalCard>
{/if}
