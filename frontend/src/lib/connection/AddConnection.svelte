<script>
	// Add connection: a remote from a pairing payload, or by name, address
	// and password (or "this service has no password"). Dispatches `added`
	// with the new connection's id.
	import { createEventDispatcher } from "svelte";
	import { modeCurrent, SlideToggle } from "@skeletonlabs/skeleton";
	import { QrCode } from "lucide-svelte";
	import { primaryButton } from "../launchpad/format.js";
	import { addConnection, errorText } from "./manage.js";
	import { parsePairing } from "./pairing.js";

	const dispatch = createEventDispatcher();
	$: primary = primaryButton($modeCurrent);
	let payload = "";
	let name = "";
	let url = "";
	let password = "";
	let noPassword = false;
	let error = "";
	let busy = false;

	async function add(input) {
		busy = true;
		error = "";
		try {
			const saved = await addConnection(input);
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
	<p class="mt-3 flex items-center gap-2 text-xs opacity-70"><QrCode size={14} /> Pairing</p>
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
