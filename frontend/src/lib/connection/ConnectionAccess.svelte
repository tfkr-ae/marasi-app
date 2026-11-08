<script>
	// A connection's password and, for the local instance, sharing. The
	// password shows masked, with reveal and copy, for every connection;
	// Change password and Turn off password… need the connection active.
	// Share binds the control listener on one of the service host's
	// interfaces; once shared, the pairing QR code sits on the left and the
	// URL, the host in the code and Copy pairing payload on the right.
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import { Copy, Eye, EyeOff } from "lucide-svelte";
	import { ConnectionPassword, LocalPairing } from "../bindings/github.com/tfkr-ae/marasi-app/app.js";
	import { neutralButton, primaryButton } from "../launchpad/format.js";
	import { service } from "../service/index.js";
	import { connectionStore } from "../../stores/connectionStore.js";
	import { defaultInterface, interfaceOptions, isShared, pairingWithHost, qrPath } from "./sharing.js";
	import { errorText } from "./manage.js";

	export let connection;
	/** The Settings row class, or the modal's. */
	export let row;

	$: neutral = neutralButton($modeCurrent);
	$: primary = primaryButton($modeCurrent);
	$: state = $connectionStore;
	$: isActive = connection.id === state.connection.id;
	$: live = isActive && state.phase === "connected";
	$: local = connection.kind === "local";
	// The password is off: the service says so, or the saved remote does.
	$: passwordOff = isActive && state.control ? !state.control.passwordSet : Boolean(connection.noPassword);
	$: busy = state.busy;
	$: shared = live && local && isShared(state.control);

	let error = "";
	const attempt = (fn) => async (...args) => {
		error = "";
		try {
			const refusal = await fn(...args);
			if (typeof refusal === "string") error = refusal;
		} catch (err) {
			error = errorText(err);
		}
	};

	// Read only when asked, so the password never sits in a store.
	let revealed = null;
	async function readPassword() {
		return local ? (await LocalPairing(connection.id)).password : await ConnectionPassword(connection.id);
	}
	const toggleReveal = attempt(async () => {
		revealed = revealed === null ? await readPassword() : null;
	});
	let copied = "";
	async function copyText(text, what) {
		await navigator.clipboard.writeText(text);
		copied = what;
		setTimeout(() => copied === what && (copied = ""), 1500);
	}
	const copyPassword = attempt(async () => copyText(await readPassword(), "password"));
	const changePassword = attempt(async () => {
		revealed = null;
		return connectionStore.changePassword();
	});

	let askingOrigins = false;
	let origins = "";
	const turnOff = attempt(async () => {
		const refusal = connectionStore.turnOffPassword(origins.split(/[\s,]+/));
		if (!refusal) {
			askingOrigins = false;
			origins = "";
			revealed = null;
		}
		return refusal;
	});

	// Sharing: the service host's interfaces, read once the details open.
	let interfaces = [];
	let address = "";
	let port = "";
	$: if (live && local && !state.control) connectionStore.readControl();
	$: if (live && local && !interfaces.length) loadInterfaces();
	async function loadInterfaces() {
		try {
			const items = (await service.get("/listener/interfaces"))?.items ?? [];
			interfaces = items;
			if (!address) address = defaultInterface(items);
		} catch (err) {
			error = errorText(err);
		}
	}
	const share = attempt(async () => connectionStore.share(address, port === "" ? 0 : Number(port), state.shareHost));
	const stopSharing = attempt(async () => connectionStore.stopSharing());

	// The pairing payload of the shared listener, read again when it moves
	// or its password changes.
	let pairing = null;
	let pairingKey = "";
	$: key = shared && !busy ? `${state.control.address}|${state.control.passwordSet}|${state.url}` : "";
	$: if (key !== pairingKey) {
		pairingKey = key;
		pairing = null;
		if (key) loadPairing();
	}
	async function loadPairing() {
		try {
			pairing = await LocalPairing(connection.id);
		} catch (err) {
			error = errorText(err);
		}
	}
	let host = $connectionStore.shareHost;
	$: payload = pairing ? safePayload(pairing, state.shareHost) : null;
	function safePayload(p, h) {
		try {
			return pairingWithHost(p, h);
		} catch {
			return pairingWithHost(p, "");
		}
	}
	$: code = payload ? qrPath(JSON.stringify(payload)) : null;
	function setHost() {
		error = connectionStore.setShareHost(host) ?? "";
	}
	const copyPayload = attempt(async () => copyText(JSON.stringify(payload), "payload"));
</script>

<div class="mt-3 border-t border-surface-200 dark:border-surface-700" data-testid="connection-access">
	<div class={row}>
		<div>
			<p>Password</p>
			<p class="text-xs opacity-70">{passwordOff ? "Off: only allowed origins" : "Clients send it to connect"}</p>
		</div>
		<div class="flex min-w-0 items-center gap-2">
			{#if passwordOff}
				<span class="truncate text-xs opacity-70" data-testid="connection-origins" title={state.control?.allowedOrigins?.join(", ") ?? ""}>
					{isActive && state.control ? state.control.allowedOrigins.join(", ") : (connection.allowedOrigins ?? []).join(", ")}
				</span>
			{:else}
				<span class="w-48 truncate font-mono text-xs" data-testid="connection-password-value">{revealed ?? "••••••••••••"}</span>
				<button type="button" class={neutral} title={revealed === null ? "Reveal" : "Hide"} data-testid="connection-password-reveal" on:click={toggleReveal}>
					{#if revealed === null}<Eye size={14} />{:else}<EyeOff size={14} />{/if}
				</button>
				<button type="button" class={neutral} title="Copy" data-testid="connection-password-copy" on:click={copyPassword}>
					<Copy size={14} />{copied === "password" ? " Copied" : ""}
				</button>
			{/if}
		</div>
	</div>
	{#if live}
		<div class={row}>
			<div>
				<p>{passwordOff ? "Set password" : "Change password"}</p>
				<p class="text-xs opacity-70">{passwordOff ? "Require a password again" : "New random password, stays connected"}</p>
			</div>
			<div class="flex items-center gap-2">
				{#if !passwordOff}
					<button type="button" class={neutral} disabled={!!busy} data-testid="connection-password-off" on:click={() => (askingOrigins = !askingOrigins)}>
						Turn off password…
					</button>
				{/if}
				<button type="button" class={primary} disabled={!!busy} data-testid="connection-password-change" on:click={changePassword}>
					{busy === "rotate" ? "Changing…" : passwordOff ? "Set password" : "Change password"}
				</button>
			</div>
		</div>
		{#if askingOrigins}
			<form class="flex items-center gap-2 py-2" data-testid="connection-origins-form" on:submit|preventDefault={turnOff}>
				<p class="shrink-0 text-xs opacity-70">Allowed origins</p>
				<input
					class="input h-8 min-w-0 flex-1 py-1 font-mono text-xs"
					placeholder="http://localhost:5173"
					data-testid="connection-origins-input"
					bind:value={origins}
				/>
				<button type="submit" class={primary} disabled={!!busy} data-testid="connection-origins-submit">Turn off</button>
			</form>
		{/if}
	{/if}

	{#if live && local}
		<div class={row}>
			<div>
				<p>Share</p>
				<p class="text-xs opacity-70">{shared ? `On ${state.control.address}` : "Let another device connect"}</p>
			</div>
			<form class="flex items-center gap-2" on:submit|preventDefault={share}>
				<select class="select h-8 w-56 rounded-none py-1 text-xs" data-testid="share-interface" bind:value={address}>
					{#each interfaceOptions(interfaces) as option (option.address)}
						<option value={option.address}>{option.label}</option>
					{/each}
				</select>
				<input class="input h-8 w-20 py-1 font-mono text-xs" placeholder="Any" inputmode="numeric" data-testid="share-port" bind:value={port} />
				<button type="submit" class={primary} disabled={!!busy || !address} data-testid="share-start">
					{busy === "share" ? "Sharing…" : shared ? "Move" : "Share"}
				</button>
			</form>
		</div>
		{#if shared}
			<div class="flex items-start justify-between gap-6 py-3" data-testid="share-details">
				<div class="shrink-0 bg-white p-1">
					{#if code}
						<svg viewBox="0 0 {code.size} {code.size}" class="h-40 w-40" shape-rendering="crispEdges" role="img" aria-label="Pairing QR code" data-testid="share-qr">
							<rect width={code.size} height={code.size} fill="#fff" />
							<path d={code.path} fill="#000" />
						</svg>
					{:else}
						<div class="h-40 w-40"></div>
					{/if}
				</div>
				<div class="flex min-w-0 flex-col items-end gap-2 text-right">
					<p class="max-w-full truncate font-mono text-xs" data-testid="share-url">{payload?.url ?? ""}</p>
					<form class="flex items-center gap-2" on:submit|preventDefault={setHost}>
						<label class="text-xs opacity-70" for="share-host">Host in the code</label>
						<input
							id="share-host"
							class="input h-8 w-48 py-1 font-mono text-xs"
							placeholder="Listener's own"
							data-testid="share-host"
							bind:value={host}
							on:change={setHost}
						/>
					</form>
					<button type="button" class={neutral} disabled={!payload} data-testid="share-copy" on:click={copyPayload}>
						<Copy size={14} />&nbsp;{copied === "payload" ? "Copied" : "Copy pairing payload"}
					</button>
					<button type="button" class={neutral} disabled={!!busy} data-testid="share-stop" on:click={stopSharing}>Stop sharing</button>
				</div>
			</div>
		{/if}
	{/if}
	{#if error || (isActive && state.changeError)}
		<p class="mt-2 text-xs text-error-600 dark:text-error-400" data-testid="connection-access-error">{error || state.changeError}</p>
	{/if}
</div>
