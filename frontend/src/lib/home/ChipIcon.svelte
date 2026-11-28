<script>
	// The square that holds a Home card's icon, in the card's swatch
	// (swatch.js sets --chip-bg and --chip-fg on the card).
</script>

<span class="chip-icon"><slot /></span>

<style>
	.chip-icon {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		padding: 0.5rem;
		background: var(--chip-bg);
		color: var(--chip-fg);
	}
</style>
