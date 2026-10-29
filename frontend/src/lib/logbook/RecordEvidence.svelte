<script>
	// The modal's evidence: Requests and Artifacts tabs, each a list above a
	// full-width viewer. Links and files are staged on the edit session's
	// draft: new ones are marked "new", removed ones stay struck through
	// with Undo until Save or Discard.
	import { onDestroy } from "svelte";
	import { getToastStore } from "@skeletonlabs/skeleton";
	import { FileIcon, FileText, ImageIcon, Search, Undo2, Upload, Video, X } from "lucide-svelte";
	import { logbookStore } from "../../stores/logbookStore.js";
	import { ledgerStore } from "../../stores/ledgerStore.js";
	import { createRequestPicker } from "../requestPicker.js";
	import { METHOD_CLASS, statusClass } from "../launchpad/format.js";
	import { MAX_ARTIFACT_BYTES, formatSize, previewOf } from "./artifacts.js";
	import RequestPair from "./RequestPair.svelte";
	import ArtifactPreview from "./ArtifactPreview.svelte";

	export let session;
	export let tab = "requests";
	const toastStore = getToastStore();

	$: draft = session.draft;
	$: original = session.original;
	$: kept = (id) => draft.Requests.includes(id);

	// Each pair is read once here; the list rows and the viewer share it.
	const pairs = new Map();
	function readPair(id) {
		const key = String(id);
		if (!pairs.has(key)) pairs.set(key, logbookStore.readPair(id).catch(() => null));
		return pairs.get(key);
	}

	// A list row from a pair (GetRawDetails) or a traffic search option.
	const rowOf = (details) => ({
		number: details.Request?.Number ?? null,
		method: details.Request?.Method ?? "",
		url: `${details.Request?.Host ?? ""}${details.Request?.Path ?? ""}`,
		status: details.Response?.StatusCode ?? 0,
	});
	const optionRow = (option) => ({
		number: option.Number ?? null,
		method: option.Method ?? "",
		url: `${option.Host ?? ""}${option.Path ?? ""}`,
		status: option.StatusCode ?? 0,
	});

	// Requests: the draft's, then the record's own that the draft unlinked.
	$: requestIds = [...draft.Requests, ...original.Requests.filter((id) => !draft.Requests.includes(id))];
	let rows = {};
	$: requestIds.forEach(loadRow);
	async function loadRow(id) {
		if (rows[id]) return;
		rows[id] = { method: "", url: "…", status: 0, number: null };
		const details = await readPair(id);
		rows[id] = details ? rowOf(details) : { method: "", url: "Couldn't read this request", status: 0, number: null };
	}

	// The artifact viewer reads a staged file from the file itself; it has
	// nothing stored to download yet.
	const artifactReader = {
		readArtifact: async (id) => {
			const staged = $logbookStore.session?.draft.Artifacts.find((a) => a.ID === id && a.File);
			if (!staged) return logbookStore.readArtifact(id);
			return { Data: new Uint8Array(await staged.File.arrayBuffer()) };
		},
		downloadArtifact: async (id) => (String(id).startsWith("staged-") ? false : logbookStore.downloadArtifact(id)),
	};

	let selectedRequest = session.draft.Requests[0] ?? null;
	$: if (!draft.Requests.includes(selectedRequest)) selectedRequest = draft.Requests[0] ?? null;

	// The traffic search that links requests.
	const picker = createRequestPicker(ledgerStore.searchRequests);
	let q = "";
	let searching = false;
	$: picker.search(q);
	$: hits = $picker.filter((option) => !draft.Requests.includes(option.value)).slice(0, 12);
	onDestroy(() => picker.cancel());

	function link(option) {
		rows[option.value] = optionRow(option);
		logbookStore.linkRequest(option.value);
		selectedRequest = option.value;
		q = "";
	}

	function onSearchKey(event) {
		if (event.key === "Enter" && hits[0]) {
			event.preventDefault();
			link(hits[0]);
		}
	}

	// Artifacts: the draft's, then the record's own that the draft removed.
	$: artifactIdsKept = new Set(draft.Artifacts.map((a) => a.ID));
	$: originalIds = new Set(original.Artifacts.map((a) => a.ID));
	$: artifacts = [...draft.Artifacts, ...original.Artifacts.filter((a) => !artifactIdsKept.has(a.ID))];
	let selectedArtifact = session.draft.Artifacts[0]?.ID ?? null;
	$: if (!artifactIdsKept.has(selectedArtifact)) selectedArtifact = draft.Artifacts[0]?.ID ?? null;
	$: shownArtifact = draft.Artifacts.find((a) => a.ID === selectedArtifact) ?? null;

	let over = false;
	function add(files) {
		const list = Array.from(files ?? []);
		const tooBig = list.filter((file) => file.size > MAX_ARTIFACT_BYTES);
		for (const file of tooBig) toastStore.trigger({ message: `Too large: ${file.name} (20 MB max)`, background: "variant-filled-error" });
		const fitting = list.filter((file) => file.size <= MAX_ARTIFACT_BYTES);
		if (!fitting.length) return;
		const before = new Set(draft.Artifacts.map((a) => a.ID));
		logbookStore.addArtifacts(fitting);
		tab = "artifacts";
		const added = $logbookStore.session?.draft.Artifacts.find((a) => !before.has(a.ID));
		if (added) selectedArtifact = added.ID;
	}

	const ICONS = { image: ImageIcon, video: Video, text: FileText };
	const rowClass = (selected) =>
		`group relative flex items-center gap-2 py-1 pl-2 pr-1 text-2xs ${selected ? "bg-primary-500/20" : "hover:bg-surface-200-700-token"}`;
	const newBadge = "badge flex-none rounded-sm bg-primary-500/20 px-1 py-0 font-sans text-3xs";
	const rowButton = "flex-none p-0.5 opacity-70 hover:opacity-100";
</script>

<div class="flex h-full min-h-0 flex-col" data-record-evidence>
	<div class="flex h-9 flex-none items-center gap-1 border-b border-surface-500/30 px-2 text-xs">
		<!-- The tabs' size, so the three labels share a baseline. -->
		<span class="mr-2 text-xs font-bold">Evidence</span>
		{#each [["requests", "Requests", draft.Requests.length], ["artifacts", "Artifacts", draft.Artifacts.length]] as [key, name, count]}
			<button
				type="button"
				class="relative flex h-full items-center gap-1 px-3 {tab === key ? 'font-bold' : 'opacity-70 hover:opacity-100'}"
				data-evidence-tab={key}
				on:click={() => (tab = key)}
			>
				{name} <span class="text-3xs font-normal opacity-60">{count}</span>
				<!-- The underline overlays the row's bottom edge and takes no
				     room, so the label centres in the full row. -->
				{#if tab === key}<span class="absolute -bottom-px left-0 right-0 h-0.5 bg-primary-500"></span>{/if}
			</button>
		{/each}
	</div>

	{#if tab === "requests"}
		<div class="flex max-h-[34%] min-h-0 flex-none flex-col gap-1 border-b border-surface-500/30 p-1.5">
			<div class="relative flex-none">
				<div class="flex h-8 items-center gap-2 rounded-token bg-surface-200-700-token px-2 focus-within:ring-1 focus-within:ring-primary-500/60">
					<Search size={12} class="flex-none opacity-60" />
					<input
						class="h-6 min-w-0 flex-1 border-0 bg-transparent p-0 text-xs placeholder:opacity-60 focus:ring-0"
						placeholder="Search traffic to link (#12, host or path)"
						data-request-search
						bind:value={q}
						on:focus={() => (searching = true)}
						on:blur={() => (searching = false)}
						on:keydown={onSearchKey}
					/>
				</div>
				{#if searching && q.trim()}
					<div class="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-auto rounded-container-token bg-surface-50 py-1 shadow-xl ring-1 ring-surface-500/30 dark:bg-surface-800">
						{#each hits as option (option.value)}
							{@const row = optionRow(option)}
							<button type="button" class="flex w-full items-center gap-2 px-2 py-1 text-left font-mono text-2xs hover:bg-primary-500/15" on:mousedown|preventDefault={() => link(option)}>
								<span class="w-10 flex-none opacity-60">#{row.number}</span>
								<span class="w-12 flex-none {METHOD_CLASS[row.method] ?? ''}">{row.method}</span>
								<span class="min-w-0 flex-1 truncate">{row.url}</span>
								<span class="flex-none {statusClass(row.status)}">{row.status || ""}</span>
							</button>
						{:else}
							<p class="px-2 py-1 text-2xs opacity-60">No matching traffic</p>
						{/each}
					</div>
				{/if}
			</div>
			<div class="min-h-0 flex-1 overflow-auto">
				{#each requestIds as id (id)}
					{@const row = rows[id] ?? {}}
					{@const gone = !kept(id)}
					<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
					<div class="{rowClass(selectedRequest === id)} font-mono {gone ? '' : 'cursor-pointer'}" data-request-row on:click={() => !gone && (selectedRequest = id)}>
						{#if selectedRequest === id}<span class="absolute bottom-0 left-0 top-0 w-[3px] bg-primary-500"></span>{/if}
						<span class="w-10 flex-none opacity-60">{row.number ? `#${row.number}` : ""}</span>
						<span class="w-12 flex-none {gone ? 'opacity-40' : (METHOD_CLASS[row.method] ?? '')}">{row.method}</span>
						<span class="min-w-0 flex-1 truncate {gone ? 'line-through opacity-40' : ''}" title={row.url}>{row.url}</span>
						{#if !original.Requests.includes(id)}<span class={newBadge}>new</span>{/if}
						<span class="w-8 flex-none text-right {gone ? 'opacity-40' : statusClass(row.status)}">{row.status || ""}</span>
						{#if gone}
							<button type="button" class={rowButton} title="Undo unlink" aria-label="Undo unlink" on:click|stopPropagation={() => logbookStore.linkRequest(id)}><Undo2 size={12} /></button>
						{:else}
							<button type="button" class="{rowButton} opacity-0 group-hover:opacity-60" title="Unlink" aria-label="Unlink" on:click|stopPropagation={() => logbookStore.unlinkRequest(id)}><X size={12} /></button>
						{/if}
					</div>
				{:else}
					<p class="px-2 py-3 text-center text-2xs opacity-60">No requests linked</p>
				{/each}
			</div>
		</div>
		<div class="min-h-0 min-w-0 flex-1">
			{#if selectedRequest}
				<RequestPair id={selectedRequest} read={readPair} />
			{:else}
				<p class="p-8 text-center text-2xs opacity-60">Link a request to view it</p>
			{/if}
		</div>
	{:else}
		<div class="flex max-h-[34%] min-h-0 flex-none flex-col gap-1 border-b border-surface-500/30 p-1.5">
			<label
				class="flex flex-none cursor-pointer items-center justify-center gap-2 rounded-token border border-dashed border-surface-500/50 px-3 py-2 text-2xs {over ? 'bg-primary-500/15' : 'hover:bg-surface-200-700-token'}"
				on:dragover|preventDefault={() => (over = true)}
				on:dragleave={() => (over = false)}
				on:drop|preventDefault={(e) => {
					over = false;
					add(e.dataTransfer?.files);
				}}
			>
				<Upload size={12} class="opacity-70" /><span>Drop files or <u>browse</u></span><span class="opacity-50">· 20 MB max</span>
				<input
					type="file"
					multiple
					class="hidden"
					data-artifact-input
					on:change={(e) => {
						add(e.currentTarget.files);
						e.currentTarget.value = "";
					}}
				/>
			</label>
			<div class="min-h-0 flex-1 overflow-auto">
				{#each artifacts as artifact (artifact.ID)}
					{@const gone = !artifactIdsKept.has(artifact.ID)}
					<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
					<div class="{rowClass(selectedArtifact === artifact.ID)} {gone ? '' : 'cursor-pointer'}" data-artifact-row on:click={() => !gone && (selectedArtifact = artifact.ID)}>
						{#if selectedArtifact === artifact.ID}<span class="absolute bottom-0 left-0 top-0 w-[3px] bg-primary-500"></span>{/if}
						<svelte:component this={ICONS[previewOf(artifact)] ?? FileIcon} size={13} class="flex-none {gone ? 'opacity-40' : 'text-primary-500'}" />
						<span class="min-w-0 flex-1 truncate {gone ? 'line-through opacity-40' : ''}" title={artifact.Filename}>{artifact.Filename}</span>
						{#if !originalIds.has(artifact.ID)}<span class={newBadge}>new</span>{/if}
						<span class="flex-none text-3xs opacity-50">{formatSize(artifact.Size)}</span>
						{#if gone}
							<button type="button" class={rowButton} title="Undo remove" aria-label="Undo remove" on:click|stopPropagation={() => logbookStore.restoreArtifact(artifact.ID)}><Undo2 size={12} /></button>
						{:else}
							<button type="button" class="{rowButton} opacity-0 group-hover:opacity-60" title="Remove" aria-label="Remove" on:click|stopPropagation={() => logbookStore.removeArtifact(artifact.ID)}><X size={12} /></button>
						{/if}
					</div>
				{:else}
					<p class="px-2 py-3 text-center text-2xs opacity-60">No artifacts</p>
				{/each}
			</div>
		</div>
		<div class="min-h-0 min-w-0 flex-1">
			<ArtifactPreview artifact={shownArtifact} store={artifactReader} />
		</div>
	{/if}
</div>
