<script>
	// The Marasi CLI setup, in ConnectionDetail when the local connection
	// failed because there is no Marasi CLI (cli_missing). Install puts the
	// CLI from Marasi's release into a folder; or point the app at a CLI you
	// have. Either way the connection then starts again.
	import { getToastStore, modeCurrent } from "@skeletonlabs/skeleton";
	import { createEventDispatcher, onMount } from "svelte";
	import {
		BrowseCLIPath,
		DefaultCLIInstallDir,
		InstallCLI,
		UseCLIPath,
	} from "../bindings/github.com/tfkr-ae/marasi-app/app.js";
	import { neutralVariant, primaryVariant } from "../launchpad/format.js";
	import { connectionStore } from "../../stores/connectionStore.js";
	import { cliResultText } from "./cli.js";

	const toastStore = getToastStore();
	// found: the CLI now in use (CLIInfo), after an install or Use.
	const dispatch = createEventDispatcher();
	let dir = "";
	let path = "";
	let busy = false;
	let problem = "";

	onMount(() => DefaultCLIInstallDir().then((d) => (dir = d || dir)));

	$: primary = `btn btn-sm rounded-none ${primaryVariant($modeCurrent)}`;
	$: neutral = `btn btn-sm rounded-none ${neutralVariant($modeCurrent)}`;
	const field = "input h-8 min-w-0 flex-1 rounded-none border-0 bg-white py-1 font-mono text-xs ring-0 dark:bg-surface-700";

	async function run(action) {
		busy = true;
		problem = "";
		try {
			await action();
		} catch (err) {
			problem = String(err?.message ?? err);
		} finally {
			busy = false;
		}
	}

	const install = () =>
		run(async () => {
			const result = await InstallCLI(dir);
			if (result.outcome !== "installed") {
				problem = cliResultText(result);
				return;
			}
			toastStore.trigger({ message: cliResultText(result) });
			dispatch("found", result.cli);
			connectionStore.retry();
		});

	const use = () =>
		run(async () => {
			const info = await UseCLIPath(path);
			toastStore.trigger({ message: "Marasi CLI set" });
			dispatch("found", info);
			connectionStore.retry();
		});

	const browse = () =>
		BrowseCLIPath()
			.then((chosen) => {
				if (chosen) path = chosen;
			})
			.catch((err) => console.error("Opening the file dialog failed:", err));
</script>

<div class="mt-3 space-y-4 text-sm" data-testid="cli-setup">
	<div>
		<p class="font-semibold">Marasi CLI not found</p>
		<p class="text-xs opacity-70">The app runs Marasi through its CLI.</p>
	</div>
	<div>
		<p class="mb-1 text-xs">Install to</p>
		<div class="flex gap-2">
			<input class={field} bind:value={dir} aria-label="Install folder" data-testid="cli-install-dir" />
			<button type="button" class={primary} disabled={busy || !dir.trim()} on:click={install} data-testid="cli-install"
				>{busy ? "Installing…" : "Install"}</button
			>
		</div>
	</div>
	<div>
		<p class="mb-1 text-xs">Or use one you have</p>
		<div class="flex gap-2">
			<input class={field} bind:value={path} placeholder="/path/to/marasi" aria-label="Marasi CLI path" data-testid="cli-path" />
			<button type="button" class={neutral} disabled={busy} on:click={browse}>Browse</button>
			<button type="button" class={primary} disabled={busy || !path.trim()} on:click={use} data-testid="cli-use">Use</button>
		</div>
	</div>
	{#if problem}
		<p class="bg-error-500/10 px-2 py-1 text-xs break-words" role="alert" data-testid="cli-problem">{problem}</p>
	{/if}
</div>
