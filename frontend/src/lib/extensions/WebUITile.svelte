<script>
	// The rail tile of an extension that ships its own web component UI
	// (`ui_code`). The service doesn't serve those yet, so the tile is
	// disabled with a short note.
	import { PuzzleIcon } from "lucide-svelte";

	export let name;
</script>

<div
	class="w-full aspect-square flex flex-col justify-center items-stretch text-center space-y-1 opacity-50 cursor-not-allowed"
	role="link"
	aria-disabled="true"
	title="{name}: web UI not available yet"
	data-testid="extension-web-ui-tile"
>
	<div class="flex justify-center items-center"><PuzzleIcon size="18" /></div>
	<div class="text-2xs font-semibold leading-tight">{name}</div>
	<div class="text-3xs leading-tight">Not available yet</div>
</div>
