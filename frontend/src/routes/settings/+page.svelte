<script>
	// Settings, one section at a time. The sections list is styled like
	// Marasi menu entries; each setting is a row with its name and help on
	// the left and its control in one fixed-width column on the right, so
	// inputs, buttons and switches line up. Lists are tables with the add
	// row underneath.
	import { Chrome, FileType, Globe, Highlighter, Info, Keyboard, Pencil, RefreshCw, Replace, Search, Wrench, X } from "lucide-svelte";
	import {
		CreateWaypoint,
		DeleteWaypoint,
		SetFlag,
		ToggleFlag,
		GetChromePaths,
		AddChromePath,
		DeleteChromePath,
		GetChromeProfiles,
		AddChromeProfile,
		DeleteChromeProfile,
		GetBuildInfo,
		GetUpdateSettings,
		SetAutomaticUpdateChecks,
	} from "../../lib/wailsjs/go/main/App";
	import {
		keybindingState,
		lineWrap,
		marasiConfig,
		populateWaypoints,
		waypoints,
	} from "../../stores";
	import {
		getModalStore,
		getToastStore,
		SlideToggle,
		modeCurrent,
	} from "@skeletonlabs/skeleton";
	import { onMount } from "svelte";
	import { page } from "$app/stores";
	import { wrapStartsOn } from "../../lib/lineWrap.js";
	import { goto } from "$app/navigation";
	import {
		channelSwitchNotice,
		showsUpdateIndicator,
		updatePanelModal,
		updateStatusLine,
	} from "../../lib/updates.js";
	import {
		checkForUpdatesAndShowResult,
		reinstallLatestRelease,
		setUpdateChannel,
		updateState,
	} from "../../stores/updateStore";
	import { chromeError } from "../../lib/globalActions.js";
	import { toastError } from "../../lib/toasts.js";
	import { neutralVariant, primaryVariant } from "../../lib/launchpad/format.js";
	import {
		highlightPalette,
		resetHighlights,
		saveHighlights,
	} from "../../stores/highlightsStore.js";
	import { ledgerStore } from "../../stores/ledgerStore";
	import { select } from "../../lib/storeSelect.js";
	import { groupBuilding, jobLabel, jobsStore, jobStatus } from "../../stores/jobsStore";
	import {
		exclusionGroups,
	} from "../../lib/ledger/contentTypes.js";
	const toastStore = getToastStore();
	const modalStore = getModalStore();

	const sections = [
		{ id: "editing", name: "Keyboard & Editor", hint: "Shortcuts, Vim, syntax", icon: Keyboard },
		{ id: "listener", name: "Listener", hint: "Default interface and port", icon: Globe },
		{ id: "waypoints", name: "Waypoints", hint: "Host overrides", icon: Replace },
		{ id: "browser", name: "Browser", hint: "Chrome paths and profiles", icon: Chrome },
		{ id: "highlights", name: "Highlights", hint: "Colours and labels", icon: Highlighter },
		{ id: "content-types", name: "Content Types", hint: "Types the Ledger hides", icon: FileType },
		{ id: "maintenance", name: "Maintenance", hint: "Background jobs and rebuilds", icon: Wrench },
		{ id: "updates", name: "Updates", hint: "Channel and checks", icon: RefreshCw },
		{ id: "about", name: "About", hint: "Version and build", icon: Info },
	];
	const syntaxModes = [
		["disabled", "Disabled"],
		["auto", "Auto"],
		["enabled", "Enabled"],
	];
	const channels = [
		["release", "Release"],
		["nightly", "Nightly"],
	];
	let section = "editing";
	// ?section=<id> opens a section, as the update panel's link to the
	// Channel setting does. Choosing a section puts it in the URL, so that
	// link switches section even after the researcher moved to another one.
	$: requestedSection = $page.url.searchParams.get("section");
	$: if (sections.some((entry) => entry.id === requestedSection)) section = requestedSection;
	function selectSection(id) {
		section = id;
		goto(`?section=${id}`, { replaceState: true, noScroll: true, keepFocus: true });
	}

	let targetHost = "";
	let override = "";
	let selected = "";
	let selectedOS = "";
	let selectedPath = "";
	let selectedProfile = "";
	let chromePaths = [];
	let chromeProfiles = [];
	let buildInfo = null;
	// The update settings (Go UpdateSettings), null until read.
	let updateSettings = null;
	let automaticChecks = false;
	// Settings → Content Types' one box: it filters the list, and Enter adds
	// what it holds when that is a new type/subtype or type/*.
	let contentTypeFind = "";

	// The app default content-type exclusion, which every project follows
	// until it keeps its own list from the Ledger's Types menu.
	const defaultExclusion = select(ledgerStore, (state) => state.defaultExclusion ?? []);
	$: contentTypeList = exclusionGroups($defaultExclusion, contentTypeFind);

	$: primary = primaryVariant($modeCurrent);
	// Home's Open Project button: the app's neutral style.
	$: neutral = neutralVariant($modeCurrent);
	$: iconButton = `btn-icon inline-flex items-center justify-center p-1 w-auto h-auto ${primary}`;
	const tableField =
		"input h-8 w-full bg-white dark:bg-surface-700 border-0 py-1 text-sm ring-0 focus:border-0 focus:ring-0";
	const row =
		"flex items-center justify-between gap-8 py-3 border-b border-surface-300 dark:border-surface-600";
	const control = "flex w-80 shrink-0";

	$: keybindingSummary = (() => {
		const config = $keybindingState?.config;
		const active = config?.profiles?.find(
			(profile) => profile.id === config.activeProfile,
		);
		if (!active) return "Factory shortcuts";
		const count = config.profiles.length;
		return `${active.name} profile active · ${count} profile${count === 1 ? "" : "s"}`;
	})();

	function openKeybindings() {
		modalStore.trigger({ type: "component", component: "Keybindings" });
	}
	function setFlag(name, value) {
		SetFlag(name, value).then((config) => {
			marasiConfig.set(config);
		});
	}
	// Choosing a Line wrapping mode also turns Wrap lines on, or off for
	// Disabled, as a launch does.
	function setWrapMode(value) {
		SetFlag("wrap_mode", value).then((config) => {
			marasiConfig.set(config);
			lineWrap.set(wrapStartsOn(config.WrapMode));
		});
	}
	function saveWaypoint() {
		CreateWaypoint(targetHost, override)
			.then(() => {
				targetHost = "";
				override = "";
				selected = "";
				populateWaypoints();
			})
			.catch((waypointErr) => {
				console.log(waypointErr);
			});
	}
	function deleteWaypoint(host) {
		DeleteWaypoint(host)
			.then(() => {
				populateWaypoints();
			})
			.catch((deleteError) => {
				console.log(deleteError);
			});
	}
	function addChromePath() {
		AddChromePath(selectedPath, selectedOS)
			.then((paths) => {
				chromePaths = paths;
				selectedPath = "";
				selectedOS = "";
			})
			.catch(chromeError(toastStore, "Error adding path"));
	}
	function deleteChromePath(path) {
		DeleteChromePath(path.Path, path.OS)
			.then((paths) => {
				chromePaths = paths;
			})
			.catch(chromeError(toastStore, "Error deleting path"));
	}
	function addChromeProfile() {
		AddChromeProfile(selectedProfile)
			.then((profiles) => {
				chromeProfiles = profiles;
			})
			.catch((error) =>
				chromeError(
					toastStore,
					String(error).includes("already exists")
						? "Profile already exists"
						: "Error creating profile",
				)(error),
			);
		selectedProfile = "";
	}
	function deleteChromeProfile(profile) {
		DeleteChromeProfile(profile)
			.then((profiles) => {
				chromeProfiles = profiles;
			})
			.catch(chromeError(toastStore, "Error deleting profile"));
	}

	// Each change saves all 8 app highlights, so the form mirrors the file.
	function saveHighlight(number, change) {
		const next = $highlightPalette.map((h) => ({ color: h.color, label: h.appLabel ?? "" }));
		next[number - 1] = { ...next[number - 1], ...change };
		saveHighlights(next).catch((error) => toastError(toastStore, "Error saving highlights", error));
	}
	function confirmResetHighlights() {
		modalStore.trigger({
			type: "confirm",
			title: "Reset highlights?",
			body: "Restores the default colours and clears every app-wide label. Project labels are kept.",
			response: (ok) => {
				if (!ok) return;
				resetHighlights().catch((error) => toastError(toastStore, "Error resetting highlights", error));
			},
		});
	}

	function saveDefaultExclusion(types) {
		ledgerStore.saveDefaultExclusion(types).catch((error) => {
			toastError(toastStore, "Error saving the default content types", error);
			ledgerStore.loadDefaultExclusion().catch(() => {});
		});
	}
	function addDefaultContentType() {
		if (!contentTypeList.addable) return;
		saveDefaultExclusion([...$defaultExclusion, contentTypeList.addable]);
		contentTypeFind = "";
	}

	// Rebuilding resets the job and redoes it over every pair; the notices
	// show until it finishes.
	const rebuilds = {
		index: {
			title: "Rebuild the search index?",
			body: "Marasi indexes every pair again, which can take a while on a large project. Text matches may be incomplete until it finishes.",
		},
		sitemap: {
			title: "Rebuild the sitemap?",
			body: "Marasi places every pair in the sitemap again. Sitemap counts may be low until it finishes.",
		},
	};
	function confirmRebuild(group) {
		modalStore.trigger({
			type: "confirm",
			...rebuilds[group],
			buttonTextConfirm: "Rebuild",
			response: (ok) => {
				if (!ok) return;
				jobsStore.rebuild(group).catch((error) => toastError(toastStore, "Error starting the rebuild", error));
			},
		});
	}
	$: if (section === "maintenance") jobsStore.refresh();

	// Turns automatic update checks on or off; on failure the switch goes back.
	function setAutomaticChecks(on) {
		SetAutomaticUpdateChecks(on)
			.then((settings) => {
				updateSettings = settings;
				automaticChecks = settings.AutomaticChecks;
			})
			.catch((error) => {
				automaticChecks = !on;
				toastError(toastStore, "Error saving automatic update checks", error);
			});
	}

	// Switches the Channel. Switching to nightly checks at once: an update
	// opens the details panel, anything else is a toast.
	let switchingChannel = false;
	function chooseChannel(channel) {
		if (switchingChannel || updateSettings?.Channel === channel) return;
		switchingChannel = true;
		setUpdateChannel(channel)
			.then((change) => {
				updateSettings = change.Settings;
				const notice = channelSwitchNotice(change, buildInfo);
				if (notice) {
					toastStore.trigger(notice);
				} else {
					modalStore.trigger(updatePanelModal());
				}
			})
			.catch((error) => toastError(toastStore, "Error switching channel", error))
			.finally(() => (switchingChannel = false));
	}

	// Settings → Updates' Check runs "Check for updates…": an update opens the
	// details panel; otherwise a toast says why there is none.
	let checking = false;
	function checkNow() {
		if (checking) return;
		checking = true;
		checkForUpdatesAndShowResult(toastStore, () => modalStore.trigger(updatePanelModal())).finally(
			() => (checking = false),
		);
	}

	// "Reinstall latest release": Go shows the warning about newer projects,
	// then installs; the panel opens to offer Restart now, or the failure.
	let reinstalling = false;
	function reinstall() {
		if (reinstalling) return;
		reinstalling = true;
		reinstallLatestRelease()
			.then((result) => {
				if (result.Outcome === "installed") {
					// The reinstalled release follows the release channel.
					GetUpdateSettings().then((settings) => (updateSettings = settings));
				}
				if (result.Outcome === "installed" || result.Outcome === "failed") {
					modalStore.trigger(updatePanelModal());
				}
			})
			.catch((error) => toastError(toastStore, "Could not reinstall the latest release", error))
			.finally(() => (reinstalling = false));
	}

	onMount(() => {
		ledgerStore.loadDefaultExclusion().catch((error) => {
			console.error("Reading the default content types failed:", error);
		});
		GetBuildInfo().then((info) => {
			buildInfo = info;
		});
		GetUpdateSettings()
			.then((settings) => {
				updateSettings = settings;
				automaticChecks = settings.AutomaticChecks;
			})
			.catch((error) => toastError(toastStore, "Error reading the update settings", error));
		GetChromePaths()
			.then((paths) => {
				chromePaths = paths;
			})
			.catch(chromeError(toastStore, "Error reading Chrome paths"));
		GetChromeProfiles()
			.then((profiles) => {
				chromeProfiles = profiles;
			})
			.catch(chromeError(toastStore, "Error reading Chrome profiles"));
	});
</script>

<div class="no-select flex h-full min-h-0 flex-col p-4 text-sm text-surface-900-50-token">
	<header class="mb-4 flex items-baseline gap-3">
		<h2 class="text-base font-bold">Marasi Settings</h2>
		{#if buildInfo}
			<span
				class="font-mono text-sm"
				class:text-primary-500={buildInfo.Channel === "nightly"}
				class:text-success-500={buildInfo.Channel === "release"}
				class:opacity-60={buildInfo.Channel === "dev"}
			>
				{buildInfo.Version}
			</span>
		{/if}
	</header>

	<div class="flex min-h-0 flex-1 border-t border-surface-300 dark:border-surface-600">
		<nav
			class="w-64 shrink-0 overflow-y-auto border-r border-surface-300 py-2 dark:border-surface-600"
			aria-label="Settings sections"
		>
			{#each sections as entry}
				<button
					type="button"
					class="flex w-full items-center gap-3 border-l-4 px-3 py-2 text-left hover:bg-surface-200 focus:!outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 dark:hover:bg-surface-700 {section ===
					entry.id
						? 'border-primary-500 bg-surface-200 dark:bg-surface-700'
						: 'border-transparent'}"
					aria-current={section === entry.id ? "true" : undefined}
					on:click={() => selectSection(entry.id)}
				>
					<svelte:component this={entry.icon} size={16} class="shrink-0 opacity-80" />
					<span class="flex flex-col">
						<span>{entry.name}</span>
						<span class="text-xs opacity-70">{entry.hint}</span>
					</span>
				</button>
			{/each}
		</nav>

		<section class="min-w-0 flex-1 overflow-y-auto px-6 py-4">
			{#if section === "editing"}
				<h3 class="text-sm font-bold">Keyboard & Editor</h3>
				<div class={row}>
					<div>
						<p>Keybindings</p>
						<p class="text-xs opacity-70">{keybindingSummary}</p>
					</div>
					<div class={control}>
						<button type="button" class="btn btn-sm w-full {primary}" on:click={openKeybindings}
							>Configure Keybindings</button
						>
					</div>
				</div>
				<div class={row}>
					<div>
						<p>Vim mode</p>
						<p class="text-xs opacity-70">Vim keys in every code editor</p>
					</div>
					<div class="{control} justify-end">
						<SlideToggle
							name="vim-enabled"
							label="Vim mode"
							active="bg-primary-500"
							bind:checked={$marasiConfig.VimEnabled}
							on:change={() => {
								ToggleFlag("vim_enabled").then((config) => {
									marasiConfig.set(config);
								});
							}}
						/>
					</div>
				</div>
				<div class={row}>
					<div>
						<p>Syntax highlighting</p>
						<p class="text-xs opacity-70">
							Auto highlights requests and responses it recognises
						</p>
					</div>
					<div class="{control} grid grid-cols-3 text-sm" role="radiogroup" aria-label="Syntax highlighting">
						{#each syntaxModes as [value, label]}
							<button
								type="button"
								role="radio"
								aria-checked={$marasiConfig.SyntaxMode === value}
								class="btn btn-sm !border-0 !ring-0 {$marasiConfig.SyntaxMode === value
									? 'variant-filled-primary'
									: 'variant-soft-primary !text-surface-900 dark:!text-surface-50'}"
								on:click={() => setFlag("syntax_mode", value)}>{label}</button
							>
						{/each}
					</div>
				</div>
				<div class={row}>
					<div>
						<p>Line wrapping</p>
						<p class="text-xs opacity-70">
							Auto leaves a line over 100,000 characters unwrapped, as wrapping it freezes the editor
						</p>
					</div>
					<div class="{control} grid grid-cols-3 text-sm" role="radiogroup" aria-label="Line wrapping">
						{#each syntaxModes as [value, label]}
							<button
								type="button"
								role="radio"
								aria-checked={$marasiConfig.WrapMode === value}
								class="btn btn-sm !border-0 !ring-0 {$marasiConfig.WrapMode === value
									? 'variant-filled-primary'
									: 'variant-soft-primary !text-surface-900 dark:!text-surface-50'}"
								on:click={() => setWrapMode(value)}>{label}</button
							>
						{/each}
					</div>
				</div>
			{:else if section === "listener"}
				<h3 class="text-sm font-bold">Listener</h3>
				<p class="text-xs opacity-70">
					Used when Marasi starts. Change the running listener from the dashboard.
				</p>
				<div class={row}>
					<div>
						<p>Default interface</p>
						<p class="text-xs opacity-70">Address the proxy listens on</p>
					</div>
					<div class={control}>
						<input
							class="input h-8 w-full py-1 text-sm"
							type="text"
							placeholder="Listener"
							aria-label="Default interface"
							bind:value={$marasiConfig.DefaultAddress}
							on:change={(event) => setFlag("default_address", event?.target?.value)}
						/>
					</div>
				</div>
				<div class={row}>
					<div>
						<p>Default port</p>
						<p class="text-xs opacity-70">Port the proxy listens on</p>
					</div>
					<div class={control}>
						<input
							class="input h-8 w-full py-1 text-sm"
							type="text"
							placeholder="Listener"
							aria-label="Default port"
							bind:value={$marasiConfig.DefaultPort}
							on:change={(event) => setFlag("default_port", event?.target?.value)}
						/>
					</div>
				</div>
			{:else if section === "waypoints"}
				<h3 class="text-sm font-bold">Waypoints</h3>
				<p class="mb-4 text-xs opacity-70">Send traffic for a host to a different host:port.</p>
				<div class="table-container">
					<table class="table table-dense">
						<thead>
							<tr>
								<th class="w-[40%]">Host</th>
								<th class="w-[40%]">Override</th>
								<th class="w-[20%]"></th>
							</tr>
						</thead>
						<tbody>
							{#each Object.keys($waypoints) as host}
								<tr>
									<td class="font-mono">{host}</td>
									<td class="font-mono">{$waypoints[host]}</td>
									<td class="text-center">
										<div class="flex items-center justify-center space-x-2">
											<button
												type="button"
												class={iconButton}
												title="Edit"
												on:click={() => {
													selected = host;
													targetHost = host;
													override = $waypoints[host];
												}}><Pencil size={15} /></button
											>
											<button
												type="button"
												class={iconButton}
												title="Delete"
												on:click={() => deleteWaypoint(host)}><X size={15} /></button
											>
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
						<tfoot>
							<tr>
								<td>
									<input
										type="text"
										placeholder="Enter host (host:port)"
										class={tableField}
										bind:value={targetHost}
									/>
								</td>
								<td>
									<input
										type="text"
										placeholder="Enter override (host:port)"
										class={tableField}
										bind:value={override}
									/>
								</td>
								<td>
									<button
										type="button"
										class="btn btn-sm w-full {primary}"
										disabled={targetHost === "" ||
											override === "" ||
											(targetHost in $waypoints && selected !== targetHost)}
										on:click={saveWaypoint}
										>{selected === targetHost && targetHost !== ""
											? "Update Waypoint"
											: "Add Waypoint"}</button
									>
								</td>
							</tr>
						</tfoot>
					</table>
				</div>
			{:else if section === "content-types"}
				<div class="sticky -top-4 z-10 -mt-4 bg-surface-50-900-token pb-3 pt-4">
					<h3 class="text-sm font-bold">Content Types</h3>
					<p class="mb-3 text-xs opacity-70">
						The Ledger hides these types in every project that follows the app default. A project
						whose list is edited in the Ledger's Types menu keeps its own until it is reset.
					</p>
					<div class="flex items-stretch gap-2">
						<div class="input-group input-group-divider h-8 flex-1 grid-cols-[auto_minmax(0,1fr)]">
							<div class="input-group-shim"><Search size={15} /></div>
							<input
								id="settingsNewContentType"
								type="text"
								placeholder="Filter, or add a type (text/css or image/*)"
								class="font-mono text-sm"
								spellcheck="false"
								autocomplete="off"
								bind:value={contentTypeFind}
								on:keydown={(e) => {
									if (e.key === "Enter") addDefaultContentType();
									if (e.key === "Escape") contentTypeFind = "";
								}}
							/>
						</div>
						<button
							type="button"
							class="btn btn-sm shrink-0 {primary}"
							disabled={!contentTypeList.addable}
							on:click={addDefaultContentType}
							>{contentTypeList.addable ? `Add ${contentTypeList.addable}` : "Add"}</button
						>
					</div>
					<p class="mt-1.5 text-xs opacity-60" id="settingsContentTypeCount">
						{#if contentTypeList.exists}
							Already hidden.
						{:else if contentTypeFind.trim()}
							{contentTypeList.shown} of {$defaultExclusion.length} match.{contentTypeList.addable
								? ` Enter adds ${contentTypeList.addable}.`
								: ""}
						{:else}
							{$defaultExclusion.length} types hidden.
						{/if}
					</p>
				</div>
				<div id="settingsDefaultContentTypes" class="columns-[18rem] gap-x-8">
					{#each contentTypeList.groups as group (group.label)}
						<section data-group={group.label} class="mb-4 break-inside-avoid">
							<h4 class="mb-1 text-xs font-semibold uppercase tracking-wide opacity-60">
								{group.label} <span class="font-normal">{group.types.length}</span>
							</h4>
							<ul>
								{#each group.types as type (type)}
									<li
										data-type={type}
										class="group flex items-center justify-between gap-2 border-b border-surface-300/60 py-1 pl-1 dark:border-surface-600/60"
									>
										<span class="truncate font-mono text-sm" title={type}>{type}</span>
										<button
											type="button"
											class="rounded p-0.5 opacity-40 hover:bg-surface-300 hover:opacity-100 group-hover:opacity-80 dark:hover:bg-surface-600"
											title="Remove {type}"
											aria-label="Remove {type}"
											on:click={() =>
												saveDefaultExclusion($defaultExclusion.filter((t) => t !== type))}
											><X size={14} /></button
										>
									</li>
								{/each}
							</ul>
						</section>
					{:else}
						{#if !contentTypeFind.trim()}<p class="text-xs opacity-60">The Ledger hides no types.</p>{/if}
					{/each}
				</div>
			{:else if section === "browser"}
				<h3 class="text-sm font-bold">Browser</h3>
				<p class="mb-4 text-xs opacity-70">Chrome that Marasi starts with the proxy configured.</p>
				<div class="table-container mb-4">
					<table class="table table-dense">
						<thead>
							<tr>
								<th>Chrome Path</th>
								<th class="w-44">OS</th>
								<th class="w-44"></th>
							</tr>
						</thead>
						<tbody>
							{#each chromePaths as path}
								<tr>
									<td class="font-mono">{path.Path}</td>
									<td>{path.OS}</td>
									<td class="text-center">
										<button
											type="button"
											class={iconButton}
											title="Delete"
											on:click={() => deleteChromePath(path)}><X size={15} /></button
										>
									</td>
								</tr>
							{/each}
						</tbody>
						<tfoot>
							<tr>
								<td>
									<input
										type="text"
										placeholder="Enter Chrome Path (e.g. /usr/bin/google-chrome)"
										class={tableField}
										bind:value={selectedPath}
									/>
								</td>
								<td>
									<select class={tableField} bind:value={selectedOS}>
										<option value="">Select OS</option>
										<option value="windows">windows</option>
										<option value="darwin">darwin</option>
										<option value="linux">linux</option>
									</select>
								</td>
								<td>
									<button
										type="button"
										class="btn btn-sm w-full {primary}"
										disabled={selectedOS === "" || selectedPath === ""}
										on:click={addChromePath}>Add Path</button
									>
								</td>
							</tr>
						</tfoot>
					</table>
				</div>
				<div class="table-container">
					<table class="table table-dense">
						<thead>
							<tr>
								<th>Chrome Profile</th>
								<th class="w-44"></th>
							</tr>
						</thead>
						<tbody>
							{#each chromeProfiles as profile}
								<tr>
									<td>{profile}</td>
									<td class="text-center">
										<button
											type="button"
											class={iconButton}
											title="Delete"
											on:click={() => deleteChromeProfile(profile)}><X size={15} /></button
										>
									</td>
								</tr>
							{/each}
						</tbody>
						<tfoot>
							<tr>
								<td>
									<input
										type="text"
										placeholder="Enter profile name"
										class={tableField}
										bind:value={selectedProfile}
									/>
								</td>
								<td>
									<button
										type="button"
										class="btn btn-sm w-full {primary}"
										disabled={selectedProfile === ""}
										on:click={addChromeProfile}>Add Profile</button
									>
								</td>
							</tr>
						</tfoot>
					</table>
				</div>
			{:else if section === "highlights"}
				<div class="flex items-baseline justify-between gap-4">
					<h3 class="text-sm font-bold">Highlights</h3>
					<button
						type="button"
						class="btn btn-sm variant-soft"
						on:click={confirmResetHighlights}>Reset to defaults</button
					>
				</div>
				<p class="text-xs opacity-70">
					Colours apply to every project. An empty label shows the colour's name. A
					project can set its own label from the Ledger.
				</p>
				{#each $highlightPalette as highlight (highlight.number)}
					<div class={row} data-highlight={highlight.number}>
						<div class="flex items-center gap-3">
							<span
								class="h-4 w-4 shrink-0 rounded-sm"
								style="background-color: {highlight.color}"
							></span>
							<div>
								<p>Highlight {highlight.number}</p>
								<p class="text-xs opacity-70">{highlight.appLabel ?? highlight.name}</p>
							</div>
						</div>
						<div class="{control} items-center gap-2">
							<input
								type="color"
								class="h-8 w-12 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
								aria-label="Highlight {highlight.number} colour"
								value={highlight.color}
								on:change={(event) =>
									saveHighlight(highlight.number, { color: event.currentTarget.value })}
							/>
							<input
								class="input h-8 w-full py-1 text-sm"
								type="text"
								aria-label="Highlight {highlight.number} label"
								placeholder={highlight.name}
								value={highlight.appLabel ?? ""}
								on:change={(event) =>
									saveHighlight(highlight.number, { label: event.currentTarget.value })}
							/>
						</div>
					</div>
				{/each}
			{:else if section === "maintenance"}
				<h3 class="text-sm font-bold">Maintenance</h3>
				<p class="mb-4 text-xs opacity-70">
					Marasi keeps the open project's search index and sitemap up to date in the background.
					After an upgrade it may still be catching up on older pairs.
				</p>
				<div class={row} id="settingsRebuildIndex">
					<div>
						<p>Search index</p>
						<p class="text-xs opacity-70">
							Rebuild when text matches look wrong. This also makes older compressed bodies
							searchable.
						</p>
					</div>
					<div class={control}>
						<button
							type="button"
							class="btn btn-sm w-full variant-soft"
							disabled={$jobsStore.rebuilding != null || groupBuilding($jobsStore, "index")}
							on:click={() => confirmRebuild("index")}
							>{groupBuilding($jobsStore, "index") ? "Building…" : "Rebuild"}</button
						>
					</div>
				</div>
				<div class={row} id="settingsRebuildSitemap">
					<div>
						<p>Sitemap</p>
						<p class="text-xs opacity-70">Rebuild when sitemap counts look wrong.</p>
					</div>
					<div class={control}>
						<button
							type="button"
							class="btn btn-sm w-full variant-soft"
							disabled={$jobsStore.rebuilding != null || groupBuilding($jobsStore, "sitemap")}
							on:click={() => confirmRebuild("sitemap")}
							>{groupBuilding($jobsStore, "sitemap") ? "Building…" : "Rebuild"}</button
						>
					</div>
				</div>
				<h4 class="mt-4 mb-2 text-sm font-bold">Background jobs</h4>
				{#if $jobsStore.error}
					<p class="mb-2 text-xs text-error-500" role="alert">{$jobsStore.error}</p>
				{/if}
				<div class="table-container">
					<table class="table table-dense" id="settingsJobs">
						<thead>
							<tr>
								<th class="w-[60%]">Job</th>
								<th class="w-[40%]">State</th>
							</tr>
						</thead>
						<tbody>
							{#each $jobsStore.jobs as job (job.Name)}
								<tr data-job={job.Name}>
									<td>{jobLabel(job.Name)}</td>
									<td
										class={job.Complete
											? "opacity-70"
											: "text-warning-800 dark:text-warning-400"}>{jobStatus(job)}</td
									>
								</tr>
							{:else}
								<tr><td colspan="2" class="opacity-70">{$jobsStore.loaded ? "No jobs" : "Loading…"}</td></tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else if section === "updates"}
				<h3 class="text-sm font-bold">Updates</h3>
				{#if updateSettings?.Channel}
					<div class={row}>
						<p>Channel</p>
						<!-- Styled as the Ledger sitemap's All / Matching toggle. -->
						<div class="{control} text-sm" role="radiogroup" aria-label="Channel">
							{#each channels as [value, label]}
								<button
									type="button"
									role="radio"
									aria-checked={updateSettings.Channel === value}
									disabled={switchingChannel}
									class="flex-1 px-3 py-1 {updateSettings.Channel === value
										? primary
										: 'bg-surface-200 hover:bg-surface-300 dark:bg-surface-700 dark:hover:bg-surface-600'}"
									on:click={() => chooseChannel(value)}>{label}</button
								>
							{/each}
						</div>
					</div>
				{/if}
				<div class={row}>
					<div>
						<p>{updateStatusLine($updateState)}</p>
						<p class="text-xs opacity-60 font-mono">{buildInfo?.Version ?? "…"}</p>
					</div>
					<div class="{control} justify-end gap-2">
						{#if showsUpdateIndicator($updateState)}
							<button
								type="button"
								class="btn btn-sm {primary}"
								on:click={() => modalStore.trigger(updatePanelModal())}>View</button
							>
						{/if}
						<button type="button" class="btn btn-sm {neutral}" disabled={checking} on:click={checkNow}
							><RefreshCw size={14} class={checking ? "animate-spin" : ""} /><span>Check</span></button
						>
					</div>
				</div>
				<div class={row}>
					<p>Check automatically</p>
					<div class="{control} justify-end">
						<SlideToggle
							name="update-checks"
							label="Check automatically"
							active="bg-primary-500"
							disabled={!updateSettings?.Channel}
							bind:checked={automaticChecks}
							on:change={() => setAutomaticChecks(automaticChecks)}
						/>
					</div>
				</div>
				{#if updateSettings?.Channel}
					<div class={row}>
						<p>Latest release</p>
						<div class="{control} justify-end">
							<button
								type="button"
								class="btn btn-sm {primary}"
								disabled={reinstalling}
								on:click={reinstall}>{reinstalling ? "Reinstalling…" : "Reinstall"}</button
							>
						</div>
					</div>
				{/if}
			{:else}
				<h3 class="text-sm font-bold">About</h3>
				<div class={row}>
					<p>Version</p>
					<p class="{control} font-mono text-sm">{buildInfo?.Version ?? "…"}</p>
				</div>
				<div class={row}>
					<p>Build channel</p>
					<p class="{control} font-mono text-sm">{buildInfo?.Channel ?? "…"}</p>
				</div>
			{/if}
		</section>
	</div>
</div>
