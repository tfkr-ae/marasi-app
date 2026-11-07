<script>
	// A running CLI install or update: its step, from Go's
	// cli-install-progress events, and the download's bar (indeterminate
	// when the size is unknown, and while verifying and installing).
	// CLISetup and CLISettings show it while InstallCLI or CheckForCLIUpdate
	// runs.
	import { ProgressBar } from "@skeletonlabs/skeleton";
	import { onDestroy } from "svelte";
	import { on } from "../runtime.js";
	import { cliProgressPercent, cliProgressText } from "./cli.js";

	let progress = null;
	const stop = on("cli-install-progress", (data) => (progress = data));
	onDestroy(stop);
</script>

<div class="space-y-1" data-testid="cli-progress">
	<p class="text-xs">{cliProgressText(progress)}</p>
	<ProgressBar value={cliProgressPercent(progress)} max={100} height="h-1.5" meter="bg-primary-500" />
</div>
