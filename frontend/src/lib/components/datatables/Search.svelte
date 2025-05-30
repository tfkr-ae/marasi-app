<script>
	export let handler;
	export let id;
	export let value;
</script>

<input
	id={id}
	class="input sm:w-64 w-36 rounded-none"
	type="search"
	placeholder="Search..."
	bind:value
	on:input={() => handler.search(value)}
/>