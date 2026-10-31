<script>
	// The connection screen: the service instances running on this machine,
	// to connect the window to one, and Start, to run a new one. It draws the
	// window connection store (stores/createWindowConnectionStore.js) and
	// connects through it.
	import { onMount } from "svelte";
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import { FolderOpen, Play, Plug, RotateCw } from "lucide-svelte";
	import Logo from "./Logo.svelte";
	import { projectName } from "../openProgress.js";
	import { instanceNameFor } from "../../stores/createWindowConnectionStore.js";
	import { pickProject } from "../../stores/windowConnectionStore.js";

	/** The window connection store. */
	export let connection;

	$: state = $connection;
	$: healthy = state.instances.filter((item) => item.healthy);
	let picked = null;
	// The first instance is picked until the researcher picks another.
	$: if (!healthy.some((item) => item.instance === picked)) picked = healthy[0]?.instance ?? null;

	// A connect that fails lists the instances again, as one may have stopped.
	async function connectTo(instance) {
		if (!(await connection.connect(instance))) await connection.listInstances();
	}

	// Start: the project (null for the scratchpad) and the instance's name,
	// which follows the project until the researcher edits it.
	let project = null;
	let name = "";
	let nameEdited = false;
	$: if (!nameEdited) name = instanceNameFor(project, state.instances.map((item) => item.instance));

	async function chooseProject() {
		const picked = await pickProject().catch(() => null);
		if (picked) project = picked;
	}

	async function start() {
		if (!(await connection.start(name.trim(), project))) await connection.listInstances();
	}

	onMount(() => {
		connection.listInstances();
		connection.readMarasi();
	});

	// The Modal's neutral and positive buttons, square.
	$: neutral =
		"btn btn-sm rounded-none " +
		($modeCurrent ? "variant-ghost-surface border-0 ring-0" : "variant-ghost-surface");
	$: positive =
		"btn btn-sm rounded-none " +
		($modeCurrent ? "variant-ghost-primary border-0 ring-0" : "variant-filled-primary");
</script>

<div class="flex min-h-full w-full items-center justify-center py-8">
	<div class="w-[32rem]">
		<header class="flex items-center gap-3">
			<Logo size="36" mode={$modeCurrent ? "light" : "dark"} />
			<div class="min-w-0">
				<h1 class="text-base font-bold">Connect to Marasi</h1>
				<p class="text-xs opacity-60">Instances running on this machine</p>
			</div>
		</header>

		<div class="mt-5 border-y border-surface-300 dark:border-surface-600">
			{#if state.instances.length}
				<ul class="max-h-72 overflow-y-auto" aria-label="Instances">
					{#each state.instances as item (item.instance)}
						<li>
							<button
								class="flex w-full items-baseline gap-3 px-2 py-1.5 text-left text-sm enabled:hover:bg-primary-500/10 disabled:opacity-50 {picked ===
								item.instance
									? '!bg-primary-500/20'
									: ''}"
								disabled={!item.healthy}
								aria-pressed={picked === item.instance}
								title={item.project ?? ""}
								on:click={() => (picked = item.instance)}
								on:dblclick={() => item.healthy && connectTo(item.instance)}
							>
								<span class="font-medium">{item.instance}</span>
								{#if item.healthy}
									<span class="truncate opacity-80">{projectName(item.project)}</span>
									<span class="ml-auto shrink-0 font-mono text-xs opacity-60">
										{item.proxy_listener ?? "No listener"}
									</span>
									<span class="shrink-0 text-xs opacity-60">{item.version}</span>
								{:else}
									<span class="ml-auto text-xs opacity-60">Not answering</span>
								{/if}
							</button>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="px-2 py-3 text-sm opacity-60">
					{state.listing ? "Looking for instances…" : "No instance is running"}
				</p>
			{/if}
		</div>

		<p class="mt-2 min-h-5 text-xs text-error-600 dark:text-error-400" role="status">
			{state.connectError ?? state.listError ?? ""}
		</p>

		<footer class="mt-2 flex justify-end gap-2">
			<button class={neutral} disabled={state.listing} on:click={() => connection.listInstances()}>
				<RotateCw size={14} /><span>Refresh</span>
			</button>
			<button
				class={positive}
				disabled={!picked || state.connecting}
				on:click={() => connectTo(picked)}
			>
				<Plug size={14} /><span>{state.connecting ? `Connecting to ${state.connecting}…` : picked ? `Connect to ${picked}` : "Connect"}</span>
			</button>
		</footer>

		<section class="mt-6 border-t border-surface-300 pt-4 dark:border-surface-600" aria-label="Start">
			<h2 class="text-sm font-bold">Start an instance</h2>
			<div class="mt-2 grid grid-cols-[5rem_1fr] items-center gap-x-3 gap-y-2 text-sm">
				<span class="opacity-60">Project</span>
				<div class="flex min-w-0 items-center gap-2">
					<span class="truncate" title={project ?? ""}>{project ? projectName(project) : "Scratchpad"}</span>
					<button class="{neutral} ml-auto" on:click={chooseProject}>
						<FolderOpen size={14} /><span>Choose…</span>
					</button>
				</div>
				<label class="opacity-60" for="start-name">Name</label>
				<input
					id="start-name"
					class="input rounded-none px-2 py-1 text-sm"
					spellcheck="false"
					bind:value={name}
					on:input={() => (nameEdited = true)}
				/>
				<span class="opacity-60">Marasi</span>
				<div class="flex min-w-0 items-center gap-2">
					<span class="truncate font-mono text-xs" title={state.marasi?.path ?? state.marasi?.bundled ?? ""}>
						{state.marasi?.path ?? "Bundled"}
					</span>
					{#if state.marasi?.path}
						<button class="{neutral} ml-auto" on:click={() => connection.chooseMarasi(true)}>Use bundled</button>
					{/if}
					<button class="{neutral} {state.marasi?.path ? '' : 'ml-auto'}" on:click={() => connection.chooseMarasi()}>
						Choose…
					</button>
				</div>
			</div>
			<div class="mt-3 flex justify-end">
				<button class={positive} disabled={!name.trim() || state.connecting} on:click={start}>
					<Play size={14} /><span>Start {name.trim()}</span>
				</button>
			</div>
		</section>
	</div>
</div>
