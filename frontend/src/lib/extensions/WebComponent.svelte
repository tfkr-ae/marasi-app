<script>
	// Draws an extension's web component (its `ui_code`, see webComponent.js)
	// at `target`: "icon" on the rail, "extension" on its page. The element
	// gets `EventsOn(name, handler)` over the service's event stream before
	// it is attached, so its connectedCallback can subscribe; the
	// subscriptions end when it leaves. A new version or ui_code
	// (extension.updated) draws a fresh element. Without a usable element,
	// the slot shows instead.
	import { service } from "../service/index.js";
	import { defineWebComponent, webComponentTag } from "./webComponent.js";

	export let name;
	export let target;
	export let code = "";
	export let version = "";

	$: tag = webComponentTag(name, target, version);
	$: error = code ? defineWebComponent(tag, code).error : "no ui_code";
	$: if (error && code) console.error(`${name}'s web component:`, error);

	// Mounts a fresh `tag` element in `host`, again whenever tag or code change.
	function mount(host, key) {
		let offs = [];
		const stop = () => {
			offs.forEach((off) => off());
			offs = [];
		};
		function draw({ tag }) {
			stop();
			const element = document.createElement(tag);
			element.className = "custom-element-container";
			element.dataset.testid = "extension-web-component";
			element.EventsOn = (event, handler) => {
				const off = service.on(event, handler);
				offs.push(off);
				return off;
			};
			host.replaceChildren(element);
		}
		draw(key);
		return {
			update: draw,
			destroy() {
				stop();
				host.replaceChildren();
			},
		};
	}
</script>

{#if !error}
	<div class="contents" use:mount={{ tag, code }}></div>
{:else}
	<slot />
{/if}
