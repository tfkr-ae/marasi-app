<script>
	// The two toolbar fields: Profile (select plus its Manage menu) and
	// Platform (select plus Reset for that platform). Choosing a profile or
	// platform only changes what the modal edits; it never activates a
	// profile or changes this device's dispatch.
	import { ChevronDown, RotateCcw } from "lucide-svelte";
	import { MACOS, WINDOWS_LINUX } from "../../keybindings/platform.js";

	export let draft;
	export let profileId;
	export let platform;
	export let devicePlatform;

	const inputClass = "bg-white dark:bg-surface-700 border-0 ring-0 focus:border-0 focus:ring-0";
	const platformNames = { [MACOS]: "macOS", [WINDOWS_LINUX]: "Windows / Linux" };
	const sideButton = "btn h-10 shrink-0 variant-soft-primary !border-0 !ring-0";
</script>

<div class="grid grid-cols-2 gap-4">
	<label class="label">
		<span>Profile</span>
		<div class="relative flex">
			<select class="select {inputClass}" bind:value={profileId}>
				{#each draft.profiles as profile (profile.id)}
					<option value={profile.id}
						>{profile.name}{profile.id === draft.activeProfile ? " (Active)" : ""}</option
					>
				{/each}
			</select>
			<!-- Make Active, Rename, New Profile, Duplicate, Import, Export, Delete. -->
			<button
				type="button"
				class={sideButton}
				aria-haspopup="menu"
				disabled
				title="Managing profiles is not available yet"
			>
				Manage <ChevronDown size={16} class="ml-1" />
			</button>
		</div>
	</label>
	<label class="label">
		<span>Platform</span>
		<div class="flex">
			<select class="select {inputClass}" bind:value={platform}>
				{#each Object.entries(platformNames) as [id, name]}
					<option value={id}>{name}{id === devicePlatform ? " (This device)" : ""}</option>
				{/each}
			</select>
			<button
				type="button"
				class={sideButton}
				disabled
				title="Resetting every {platformNames[platform]} binding is not available yet"
			>
				<RotateCcw size={16} class="mr-1" /> Reset
			</button>
		</div>
	</label>
</div>
