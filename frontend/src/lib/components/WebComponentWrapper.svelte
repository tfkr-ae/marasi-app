<script>
  import { onMount } from "svelte";
  import { GetExtensionUI } from "../wailsjs/go/main/App";
  import { EventsOn } from "../wailsjs/runtime/runtime";
  import { extensionElements, proxyItems } from "../../stores";

  export let extensionName = "";
  export let type = "";
  export let elementProps = {}; // Additional props to pass to the custom element

  let elementTag = ""; // Unique tag name for this instance
  let customElement;

  // reactively update elementProps when proxyItems change
  $: elementProps = { items: $proxyItems };
  onMount(() => {
    if (!extensionName) return;

    GetExtensionUI(extensionName).then((extensionUI) => {
      const version = extensionUI.Version;
      // Construct a unique tag name. It must match the tag name used in extensionUI.UICode.
      elementTag = `${extensionName}-${type}-${version}`;

      // Register the custom element if it hasn't been defined already.
      // IMPORTANT: extensionUI.UICode should only define/register the element
      // (via customElements.define) and must not create an instance.
      if (!customElements.get(elementTag)) {
        const scriptFunction = new Function(extensionUI.UICode);
        scriptFunction();

        // Verify registration: log an error if the element isn't registered.
        if (!customElements.get(elementTag)) {
          console.error(`Custom element '${elementTag}' was not registered.`);
        } else {
          console.log(
            `Custom element '${elementTag}' registered successfully.`,
          );
        }
      }

      // Update the store with the element instance once it’s available.
      extensionElements.update((elements) => {
        elements[elementTag] = customElement;
        return elements;
      });

      // Optionally assign the EventsOn handler if needed.
      if (type === "extension" && customElement) {
        customElement.EventsOn = EventsOn;
      }
    });
  });
</script>

<!-- Render the custom element declaratively via the Custom Elements API -->
{#if elementTag}
  <svelte:element
    this={elementTag}
    {...elementProps}
    bind:this={customElement}
    class="custom-element-container"
  />
{/if}
