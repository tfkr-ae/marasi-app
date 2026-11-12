<script>
	// Pairing in the mobile app: on iOS the camera reads the QR code another
	// Marasi app's Share shows, or Enter manually opens the add form. Android
	// has no scanner yet, so it opens on the form. Dispatches `added` with
	// the new connection's id; the modal switches to it.
	import { createEventDispatcher } from "svelte";
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import { neutralButton, primaryButton } from "../launchpad/format.js";
	import AddConnection from "./AddConnection.svelte";
	import QRScanner from "./QRScanner.svelte";
	import { addConnection, errorText } from "./manage.js";
	import { parsePairing } from "./pairing.js";
	import { scanErrorText } from "./pairing-view.js";
	import { platform } from "../platform.js";

	const dispatch = createEventDispatcher();
	$: primary = primaryButton($modeCurrent);
	$: neutral = neutralButton($modeCurrent);
	let manual = false;
	$: canScan = $platform === "ios";
	let error = "";
	let busy = false;
	// A new key reopens the camera after a code that didn't pair.
	let scan = 0;

	async function scanned(text) {
		error = "";
		let input;
		try {
			input = parsePairing(text);
		} catch (err) {
			error = errorText(err);
			scan += 1;
			return;
		}
		busy = true;
		try {
			const saved = await addConnection(input);
			dispatch("added", saved.id);
		} catch (err) {
			error = errorText(err);
			scan += 1;
		} finally {
			busy = false;
		}
	}
</script>

<div class="text-sm" data-testid="pair-connection">
	{#if manual || !canScan}
		<AddConnection on:added />
		{#if canScan}
			<button type="button" class="{neutral} mt-3" data-testid="pair-scan" on:click={() => ((manual = false), (error = ""))}>
				Scan a QR code instead
			</button>
		{/if}
	{:else}
		<h3 class="text-sm font-bold">Pair with Marasi</h3>
		<p class="mt-1 text-xs opacity-70">Scan the QR code from Share in Marasi on your computer.</p>
		<div class="mt-3 flex justify-center">
			{#if busy}
				<p class="py-8 text-xs opacity-70">Adding…</p>
			{:else}
				{#key scan}
					<QRScanner on:scanned={(e) => scanned(e.detail)} on:failed={(e) => (error = scanErrorText(e.detail))} />
				{/key}
			{/if}
		</div>
		{#if error}<p class="mt-2 text-xs text-error-600 dark:text-error-400" data-testid="pair-error">{error}</p>{/if}
		<div class="mt-3 flex justify-center">
			<button type="button" class={primary} data-testid="pair-manual" on:click={() => ((manual = true), (error = ""))}>
				Enter manually
			</button>
		</div>
	{/if}
</div>
