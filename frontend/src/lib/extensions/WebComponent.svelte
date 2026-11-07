<script>
	// Draws an extension's web component (its `ui_code`, see webComponent.js)
	// at `target`: "icon" on the rail, "extension" on its page. The element
	// gets `EventsOn(name, handler)` over the service's event stream, as
	// before the service; its subscriptions end when it leaves. A new
	// version or ui_code (extension.updated) draws a fresh element. Without
	// a usable element, the slot shows instead.
	import { onDestroy } from "svelte";
	import { service } from "../service/index.js";
	import { defineWebComponent, webComponentTag } from "./webComponent.js";

	export let name;
	export let target;
	export let code = "";
	export let version = "";

	let element;
	let offs = [];
	const stopEvents = () => {
		offs.forEach((off) => off());
		offs = [];
	};

	$: tag = webComponentTag(name, target, version);
	$: error = code ? defineWebComponent(tag, code).error : "no ui_code";
	$: if (error && code) console.error(`${name}'s web component:`, error);
	$: if (element) {
		stopEvents();
		element.EventsOn = (event, handler) => {
			const off = service.on(event, handler);
			offs.push(off);
			return off;
		};
	}
	onDestroy(stopEvents);
</script>

{#if !error}
	{#key `${tag}\n${code}`}
		<svelte:element this={tag} bind:this={element} class="custom-element-container" data-testid="extension-web-component" data-tag={tag} />
	{/key}
{:else}
	<slot />
{/if}
