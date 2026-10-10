<script>
	// Keybinding settings. Every change edits a draft of the whole keybinding
	// config (settings.js); Save persists it and only then updates live
	// bindings. Cancel, close and Escape never apply the draft, and ask before
	// discarding edits.
	import { onDestroy, onMount, tick } from "svelte";
	import { getModalStore, getToastStore, modeCurrent } from "@skeletonlabs/skeleton";
	import { Keyboard, X } from "lucide-svelte";
	import { SaveKeybindings } from "../../wailsjs/go/main/App";
	import { keybindingState } from "../../../stores.js";
	import { keybindingCapture, menuDispatcher } from "../../keybindings/app.js";
	import {
		addBinding,
		browse,
		captureKey,
		isDirty,
		openDraft,
		removeBinding,
		replaceBinding,
		resetAction,
		saveDraft,
		saveProblems,
	} from "../../keybindings/settings.js";
	import { interceptModalEscape } from "../../overlayIsolation.js";
	import ActionRows from "./ActionRows.svelte";
	import ContextSidebar from "./ContextSidebar.svelte";
	import KeybindingsToolbar from "./KeybindingsToolbar.svelte";
	import ModalCard from "./ModalCard.svelte";

	const modalStore = getModalStore();
	const toastStore = getToastStore();
	const inputClass = "bg-white dark:bg-surface-700 border-0 ring-0 focus:border-0 focus:ring-0";

	// The catalog and saved state as the modal opened.
	const catalog = menuDispatcher.catalog;
	const devicePlatform = menuDispatcher.platform;
	const loadProblem = $keybindingState?.problem ?? "";
	const opened = openDraft($keybindingState, catalog);

	let draft = opened;
	let profileId = (draft.profiles.find((p) => p.id === draft.activeProfile) ?? draft.profiles[0]).id;
	let platform = devicePlatform;
	let query = "";
	let filter = "all";
	let selectedGroup = "global";
	let capture = null; // { actionId, label, index?, message? }
	let confirmation = null; // { title, body, label, run }
	let saving = false;
	let saveError = "";
	let toolbar;
	let toolbarPending = false; // the Manage menu or the profile name card is open

	$: profile = draft.profiles.find((p) => p.id === profileId) ?? draft.profiles[0];
	$: view = browse({ catalog, profile, platform, query, filter });
	$: visibleGroups = query.trim() || filter !== "all" ? view.groups.filter((g) => g.items.length) : view.groups;
	$: if (visibleGroups.length && !visibleGroups.some((g) => g.id === selectedGroup)) {
		selectedGroup = visibleGroups[0].id;
	}
	$: current = visibleGroups.find((g) => g.id === selectedGroup);
	$: dirty = isDirty(draft, opened);
	// Every profile and platform variant, so problems off screen block Save too.
	$: problems = saveProblems(catalog, draft, { profileId: profile.id, platform });
	$: keybindingCapture.set(Boolean(capture));
	$: filters = [
		["all", `All (${view.groups.reduce((n, g) => n + g.all.length, 0)})`],
		["unbound", `Unbound (${view.unboundCount})`],
		["conflict", `Conflicts (${view.conflictCount})`],
	];

	function target(actionId) {
		return { profileId: profile.id, platform, actionId };
	}

	function edit(next) {
		draft = next;
		saveError = "";
	}

	// Brings a save problem on screen: its profile, platform and sidebar
	// entry, with search and filters cleared, then scrolls to its row.
	async function showProblem(problem) {
		if (problem.profileId && draft.profiles.some((p) => p.id === problem.profileId)) profileId = problem.profileId;
		if (problem.platform) platform = problem.platform;
		query = "";
		filter = "all";
		if (problem.groupId) selectedGroup = problem.groupId;
		await tick();
		if (problem.actionId) {
			document.querySelector(`[data-keybindings-modal] li[data-action-id="${problem.actionId}"]`)?.scrollIntoView({ block: "nearest" });
		}
	}

	function startCapture(actionId, index) {
		capture = { actionId, index, label: catalog.get(actionId)?.label ?? actionId };
	}

	// Window capture phase, after overlay isolation and the menu dispatcher
	// (which the capture flag already blocks): while recording, the key
	// belongs to the recording and nothing else sees it.
	function onCaptureKeydown(event) {
		if (!capture) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		const result = captureKey(event);
		if (!result) return;
		if (result.type === "cancel") {
			capture = null;
		} else if (result.type === "reserved") {
			capture = {
				...capture,
				message: "Escape, Tab and Enter stay with dialogs and focus. Press another combination.",
			};
		} else {
			const at = target(capture.actionId);
			edit(
				capture.index === undefined
					? addBinding(catalog, draft, at, result.binding)
					: replaceBinding(catalog, draft, at, capture.index, result.binding),
			);
			capture = null;
		}
	}

	function close() {
		modalStore.close();
	}

	function requestClose() {
		if (!dirty) return close();
		confirmation = {
			title: "Discard changes?",
			body: "Your unsaved keybinding changes will be lost.",
			label: "Discard",
			run: close,
		};
	}

	// Escape and backdrop clicks: the innermost thing gives way first.
	function dismiss() {
		if (capture) capture = null;
		else if (toolbar?.dismiss()) return;
		else if (confirmation) confirmation = null;
		else requestClose();
	}

	// Skeleton closes a modal on a backdrop click without asking. Take the
	// click over while there is something to dismiss first.
	function onBackdropPointer(event) {
		const onBackdrop = event.target?.classList?.contains("modal-backdrop") || event.target?.classList?.contains("modal-transition");
		if (!onBackdrop || !(capture || toolbarPending || confirmation || dirty)) return;
		event.stopPropagation();
		if (event.type === "mousedown") dismiss();
	}

	async function save() {
		saving = true;
		saveError = "";
		const result = await saveDraft({
			draft,
			catalog,
			save: SaveKeybindings,
			apply: (state) => keybindingState.set(state),
		});
		saving = false;
		if (!result.ok) {
			saveError = `Not saved: ${result.error}`;
			return;
		}
		toastStore.trigger({ message: "Keybindings saved", background: "variant-filled-success" });
		close();
	}

	let removeEscapeHandler = () => {};
	onMount(() => {
		removeEscapeHandler = interceptModalEscape(dismiss);
		window.addEventListener("keydown", onCaptureKeydown, true);
		window.addEventListener("mousedown", onBackdropPointer, true);
		window.addEventListener("mouseup", onBackdropPointer, true);
	});
	onDestroy(() => {
		removeEscapeHandler();
		keybindingCapture.set(false);
		if (typeof window === "undefined") return;
		window.removeEventListener("keydown", onCaptureKeydown, true);
		window.removeEventListener("mousedown", onBackdropPointer, true);
		window.removeEventListener("mouseup", onBackdropPointer, true);
	});
</script>

{#if $modalStore[0]}
	<div
		class="card relative flex h-[85vh] w-[75%] max-w-[95vw] flex-col gap-4 rounded-none border-t-4 border-primary-500 p-6 shadow-xl bg-surface-50-800-token text-surface-900-50-token"
		data-keybindings-modal
	>
		<header class="flex items-center justify-between p-2">
			<div class="flex items-center gap-2">
				<Keyboard size={24} class="text-primary-500" />
				<h2 class="text-xl font-bold">Keybindings</h2>
			</div>
			<button type="button" class="text-2xl leading-none" aria-label="Close" on:click={requestClose}><X /></button>
		</header>

		<KeybindingsToolbar
			bind:this={toolbar}
			bind:pending={toolbarPending}
			{catalog}
			{draft}
			bind:profileId
			bind:platform
			{devicePlatform}
			onEdit={edit}
			onConfirm={(next) => (confirmation = next)}
		/>

		<div class="flex items-center gap-4">
			<input
				class="input {inputClass}"
				type="search"
				placeholder="Search actions, pages or keys..."
				aria-label="Search keybindings"
				bind:value={query}
			/>
			<div class="flex shrink-0 items-center gap-1">
				{#each filters as [id, label]}
					<button
						type="button"
						class="btn btn-sm !border-0 !ring-0 {filter === id ? 'variant-filled-primary' : 'variant-soft-primary'}"
						aria-pressed={filter === id}
						on:click={() => (filter = id)}>{label}</button
					>
				{/each}
			</div>
		</div>

		<div class="flex min-h-0 flex-1 border-y border-surface-300 dark:border-surface-600">
			<ContextSidebar groups={visibleGroups} selected={selectedGroup} onSelect={(id) => (selectedGroup = id)} />
			<section class="min-w-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
				{#if current}
					<ActionRows
						rows={current.items}
						onRecord={startCapture}
						onRemove={(actionId, index) => edit(removeBinding(catalog, draft, target(actionId), index))}
						onReset={(actionId) => edit(resetAction(draft, target(actionId)))}
					/>
				{:else}
					<p class="p-4 text-sm opacity-60">No actions match.</p>
				{/if}
			</section>
		</div>

		<footer class="flex items-center justify-between gap-4">
			<div class="min-w-0 text-sm" aria-live="polite">
				{#if saveError}
					<p class="text-error-600 dark:text-error-400" data-save-error>{saveError}</p>
				{:else if problems.length}
					<p class="flex min-w-0 items-center gap-2 text-error-600 dark:text-error-400" data-save-blocked>
						<span class="min-w-0" title={problems.map((p) => p.message).join("\n")}>
							Can't save{problems.length > 1 ? ` (${problems.length} problems)` : ""}: {problems[0].message}
						</span>
						{#if problems[0].platform}
							<button
								type="button"
								class="btn btn-sm shrink-0 variant-soft-primary !border-0 !ring-0"
								on:click={() => showProblem(problems[0])}>Show</button
							>
						{/if}
					</p>
				{:else if loadProblem}
					<p class="text-warning-800 dark:text-warning-500" title={loadProblem}>
						The saved keybindings could not be used, so factory shortcuts are active. Saving replaces them.
					</p>
				{:else if dirty}
					<p class="opacity-70">Unsaved changes</p>
				{/if}
			</div>
			<div class="flex shrink-0 gap-2">
				<button
					type="button"
					class="btn {$modeCurrent ? 'variant-ghost-surface border-0 ring-0' : 'variant-ghost-surface'}"
					on:click={requestClose}>Cancel</button
				>
				<button
					type="button"
					class="btn {$modeCurrent ? 'variant-ghost-primary border-0 ring-0' : 'variant-filled-primary'}"
					disabled={!dirty || saving || problems.length > 0}
					on:click={save}>{saving ? "Saving..." : "Save"}</button
				>
			</div>
		</footer>

		{#if capture}
			<ModalCard title={capture.label} data-key-capture>
				<p>Press the new key combination.</p>
				{#if capture.message}
					<p class="text-sm text-warning-800 dark:text-warning-500">{capture.message}</p>
				{/if}
				<p class="text-sm opacity-70">
					Marasi shortcuts are paused while recording. Press <kbd class="kbd">Esc</kbd> to cancel.
				</p>
				<svelte:fragment slot="footer">
					<button type="button" class="btn variant-ghost-surface" on:click={() => (capture = null)}>Cancel</button>
				</svelte:fragment>
			</ModalCard>
		{/if}
		{#if confirmation}
			<ModalCard title={confirmation.title}>
				<p>{confirmation.body}</p>
				<svelte:fragment slot="footer">
					<button type="button" class="btn variant-ghost-surface" on:click={() => (confirmation = null)}>Cancel</button>
					<button
						type="button"
						class="btn {$modeCurrent ? 'variant-ghost-primary border-0 ring-0' : 'variant-filled-primary'}"
						on:click={() => {
							const run = confirmation.run;
							confirmation = null;
							run();
						}}>{confirmation.label}</button
					>
				</svelte:fragment>
			</ModalCard>
		{/if}
	</div>
{/if}
