<script>
	// Add connection: a local connection for an instance running on this
	// machine that no connection names yet (listed by the Marasi CLI, added
	// in one click on its current proxy port), or a named instance typed with
	// an optional proxy port, or a remote from a pairing payload, or by name,
	// address and password (or "this service has no password").
	// Dispatches `added` with the new connection's id.
	import { createEventDispatcher, onMount } from "svelte";
	import { modeCurrent, SlideToggle } from "@skeletonlabs/skeleton";
	import { Laptop, QrCode } from "lucide-svelte";
	import { neutralButton, primaryButton } from "../launchpad/format.js";
	import { connectionStore } from "../../stores/connectionStore.js";
	import { connectionFor, projectName, unsavedInstances } from "./localInstances.js";
	import { addConnection, addLocalConnection, errorText, listInstances } from "./manage.js";
	import { parsePairing } from "./pairing.js";
	import { PORT_RANGE_MESSAGE, parsePort } from "./localPort.js";

	const dispatch = createEventDispatcher();
	$: primary = primaryButton($modeCurrent);
	$: neutral = neutralButton($modeCurrent);
	let payload = "";
	let name = "";
	let url = "";
	let password = "";
	let noPassword = false;
	let error = "";
	let busy = false;
	let instance = "";
	let localName = "";
	let localPort = "";
	let instances = [];
	$: running = unsavedInstances(instances, $connectionStore.connections);
	onMount(async () => {
		instances = await listInstances();
	});

	async function add(input, save = addConnection) {
		busy = true;
		error = "";
		try {
			const saved = await save(input);
			dispatch("added", saved.id);
		} catch (err) {
			error = errorText(err);
		} finally {
			busy = false;
		}
	}
	function addPairing() {
		let input;
		try {
			input = parsePairing(payload);
		} catch (err) {
			error = errorText(err);
			return;
		}
		add(input);
	}
	function addLocal() {
		const port = parsePort(localPort);
		if (port === null) {
			error = PORT_RANGE_MESSAGE;
			return;
		}
		add({ name: localName.trim(), instance: instance.trim(), port }, addLocalConnection);
	}
	function addByHand() {
		if (!noPassword && !password) {
			error = "Enter the password, or turn on no password";
			return;
		}
		add({ name: name.trim(), url: url.trim(), password: noPassword ? "" : password, noPassword });
	}
</script>

<div class="text-sm" data-testid="add-connection">
	<h3 class="text-sm font-bold">Add a connection</h3>
	<p class="mt-3 flex items-center gap-2 text-xs opacity-70"><Laptop size={14} /> This machine</p>
	{#if running.length}
		<ul class="mt-1 divide-y divide-surface-300 border border-surface-300 text-xs dark:divide-surface-600 dark:border-surface-600" data-testid="add-local-running">
			{#each running as item (item.instance)}
				<li class="flex items-center gap-3 px-2 py-1.5" data-testid="add-local-running-item">
					<span class="h-2 w-2 shrink-0 rounded-full {item.status === 'running' ? 'bg-success-500' : 'bg-warning-500'}" title={item.status}></span>
					<span class="flex min-w-0 flex-1 flex-col">
						<span class="truncate font-mono">{item.instance}</span>
						<span class="truncate opacity-70" title={item.project}>
							{[projectName(item.project), item.proxy_listener, item.version].filter(Boolean).join(" · ")}
						</span>
					</span>
					<button type="button" class={neutral} disabled={busy} on:click={() => add(connectionFor(item), addLocalConnection)}>Add</button>
				</li>
			{/each}
		</ul>
	{/if}
	<div class="mt-2 grid grid-cols-[6rem_1fr] items-center gap-x-3 gap-y-2 text-xs">
		<span>Instance</span><input
			class="input h-8 py-1 font-mono text-xs"
			placeholder="Type a name"
			data-testid="add-local-instance"
			bind:value={instance}
		/>
		<span>Name</span><input class="input h-8 py-1 text-xs" placeholder={instance.trim() || "Work"} data-testid="add-local-name" bind:value={localName} />
		<span>Proxy port</span><input
			class="input h-8 py-1 font-mono text-xs"
			inputmode="numeric"
			placeholder="Any"
			data-testid="add-local-port"
			bind:value={localPort}
		/>
	</div>
	<div class="mt-2 flex justify-end">
		<button type="button" class={primary} disabled={busy || !instance.trim()} data-testid="add-local-submit" on:click={addLocal}>
			Add local connection
		</button>
	</div>

	<p class="mt-5 text-xs opacity-70">Remote</p>
	<p class="mt-1 flex items-center gap-2 text-xs opacity-70"><QrCode size={14} /> Pairing</p>
	<div class="mt-1 flex gap-2">
		<input
			class="input h-8 flex-1 py-1 font-mono text-xs"
			placeholder="Paste from marasi service control pair --json, or another app's Share"
			title={'{"url":"http://10.0.0.5:9000","password":"…","instance":"default"}'}
			data-testid="pairing-payload"
			bind:value={payload}
		/>
		<button type="button" class={primary} disabled={busy || !payload.trim()} on:click={addPairing}>Add</button>
	</div>

	<p class="mt-5 text-xs opacity-70">Manual</p>
	<div class="mt-1 grid grid-cols-[6rem_1fr] items-center gap-x-3 gap-y-2 text-xs">
		<span>Name</span><input class="input h-8 py-1 text-xs" placeholder="Lab box" data-testid="add-name" bind:value={name} />
		<span>Address</span><input
			class="input h-8 py-1 font-mono text-xs"
			placeholder="http://10.0.0.5:9000"
			data-testid="add-url"
			bind:value={url}
		/>
		<span>Password</span><input
			class="input h-8 py-1 text-xs"
			type="password"
			disabled={noPassword}
			data-testid="add-password"
			bind:value={password}
		/>
		<span></span>
		<SlideToggle name="no-password" size="sm" active="bg-primary-500" bind:checked={noPassword}>
			<span class="text-xs">This service has no password</span>
		</SlideToggle>
	</div>
	{#if error}<p class="mt-2 text-xs text-error-600 dark:text-error-400" data-testid="add-error">{error}</p>{/if}
	<div class="mt-3 flex justify-end">
		<button type="button" class={primary} disabled={busy || !url.trim()} data-testid="add-submit" on:click={addByHand}>
			Add connection
		</button>
	</div>
</div>
