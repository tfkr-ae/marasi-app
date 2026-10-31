<script>
	// The connection screen: the service instances running on this machine
	// and the saved remote ones, to connect the window to one, or a remote
	// by its address and token. It draws the window connection store
	// (stores/createWindowConnectionStore.js) and connects through it.
	import { onMount, tick } from "svelte";
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import { Plug, RotateCw, X } from "lucide-svelte";
	import Logo from "./Logo.svelte";
	import { projectName } from "../openProgress.js";

	/** The window connection store. */
	export let connection;

	$: state = $connection;
	$: healthy = state.instances.filter((item) => item.healthy);
	// What Connect connects to: {kind: "local", id: instance}, {kind:
	// "saved", id: url}, or {kind: "new"} for the remote form.
	let picked = null;
	// The first instance is picked until the researcher picks another.
	$: if (!pickable(picked, healthy, state.remotes)) picked = healthy[0] ? { kind: "local", id: healthy[0].instance } : null;

	function pickable(pick, healthy, remotes) {
		if (pick?.kind === "new") return true;
		if (pick?.kind === "saved") return remotes.some((item) => item.url === pick.id);
		return pick?.kind === "local" && healthy.some((item) => item.instance === pick.id);
	}
	const isPicked = (pick, kind, id) => pick?.kind === kind && pick.id === id;

	// The remote form.
	let address = "";
	let token = "";
	let name = "";
	let remember = true;
	let tokenInput;

	// A refused token fills in its remote, for the new token.
	let prompted = null;
	$: if (state.tokenPrompt && state.tokenPrompt !== prompted) askForToken(state.tokenPrompt);
	async function askForToken(remote) {
		prompted = remote;
		address = remote.url;
		name = remote.name;
		token = "";
		remember = true;
		picked = { kind: "new" };
		await tick();
		tokenInput?.focus();
	}

	$: label = picked?.kind === "local" ? picked.id
		: picked?.kind === "saved" ? state.remotes.find((item) => item.url === picked.id)?.name
		: name.trim() || address.trim();

	// A connect that fails lists the instances again, as one may have stopped.
	async function connectTo(pick) {
		if (pick?.kind === "local") {
			if (!(await connection.connect(pick.id))) await connection.listInstances();
		} else if (pick?.kind === "saved") {
			await connection.connectSaved(pick.id);
		} else if (pick?.kind === "new") {
			await connection.connectRemote({ url: address.trim(), token, name: name.trim(), save: remember });
		}
	}

	async function forget(url) {
		await connection.forgetRemote(url);
	}

	onMount(() => {
		connection.listInstances();
		connection.listRemotes();
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
								class="flex w-full items-baseline gap-3 px-2 py-1.5 text-left text-sm enabled:hover:bg-primary-500/10 disabled:opacity-50 {isPicked(
									picked,
									'local',
									item.instance,
								)
									? '!bg-primary-500/20'
									: ''}"
								disabled={!item.healthy}
								aria-pressed={isPicked(picked, "local", item.instance)}
								title={item.project ?? ""}
								on:click={() => (picked = { kind: "local", id: item.instance })}
								on:dblclick={() => item.healthy && connectTo({ kind: "local", id: item.instance })}
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

		<h2 class="mt-5 text-xs font-bold opacity-60">Remote instances</h2>
		<div class="mt-1 border-y border-surface-300 dark:border-surface-600">
			{#if state.remotes.length}
				<ul class="max-h-40 overflow-y-auto" aria-label="Saved remotes">
					{#each state.remotes as item (item.url)}
						<li class="group flex items-center {isPicked(picked, 'saved', item.url) ? 'bg-primary-500/20' : 'hover:bg-primary-500/10'}">
							<button
								class="flex min-w-0 flex-1 items-baseline gap-3 px-2 py-1.5 text-left text-sm"
								aria-pressed={isPicked(picked, "saved", item.url)}
								on:click={() => (picked = { kind: "saved", id: item.url })}
								on:dblclick={() => connectTo({ kind: "saved", id: item.url })}
							>
								<span class="truncate font-medium">{item.name}</span>
								<span class="ml-auto shrink-0 font-mono text-xs opacity-60">{item.url}</span>
							</button>
							<button
								class="px-2 opacity-0 hover:opacity-100 focus:opacity-100 group-hover:opacity-60"
								title="Forget {item.name}"
								aria-label="Forget {item.name}"
								on:click={() => forget(item.url)}
							>
								<X size={14} />
							</button>
						</li>
					{/each}
				</ul>
			{/if}
			<form
				class="grid grid-cols-[5rem_1fr] items-center gap-x-2 gap-y-1 px-2 py-2 text-sm {picked?.kind === 'new'
					? 'bg-primary-500/10'
					: ''}"
				aria-label="Remote instance"
				on:focusin={() => (picked = { kind: "new" })}
				on:submit|preventDefault={() => connectTo({ kind: "new" })}
			>
				<label for="remote-address" class="text-xs opacity-60">Address</label>
				<input
					id="remote-address"
					class="input h-7 rounded-none border-0 bg-surface-100 py-0 font-mono text-xs ring-0 focus:ring-0 dark:bg-surface-700"
					placeholder="http://10.0.0.5:7070"
					autocomplete="off"
					spellcheck="false"
					bind:value={address}
				/>
				<label for="remote-token" class="text-xs opacity-60">Token</label>
				<input
					id="remote-token"
					type="password"
					class="input h-7 rounded-none border-0 bg-surface-100 py-0 font-mono text-xs ring-0 focus:ring-0 dark:bg-surface-700"
					placeholder="Control token"
					autocomplete="off"
					bind:this={tokenInput}
					bind:value={token}
				/>
				<label for="remote-name" class="text-xs opacity-60">Name</label>
				<input
					id="remote-name"
					class="input h-7 rounded-none border-0 bg-surface-100 py-0 text-xs ring-0 focus:ring-0 dark:bg-surface-700"
					placeholder="Optional"
					autocomplete="off"
					bind:value={name}
				/>
				<span></span>
				<label class="flex items-center gap-2 text-xs">
					<input type="checkbox" class="checkbox" bind:checked={remember} />
					<span>Remember</span>
				</label>
				<!-- Enter in a field connects. -->
				<button type="submit" class="hidden" aria-hidden="true" tabindex="-1"></button>
			</form>
		</div>

		<p class="mt-2 min-h-5 text-xs text-error-600 dark:text-error-400" role="status">
			{state.connectError ?? state.listError ?? ""}
		</p>

		<footer class="mt-2 flex justify-end gap-2">
			<button
				class={neutral}
				disabled={state.listing}
				on:click={() => {
					connection.listInstances();
					connection.listRemotes();
				}}
			>
				<RotateCw size={14} /><span>Refresh</span>
			</button>
			<button
				class={positive}
				disabled={!picked || state.connecting || (picked.kind === "new" && (!address.trim() || !token.trim()))}
				on:click={() => connectTo(picked)}
			>
				<Plug size={14} /><span>{state.connecting ? `Connecting to ${state.connecting}…` : label ? `Connect to ${label}` : "Connect"}</span>
			</button>
		</footer>
	</div>
</div>
