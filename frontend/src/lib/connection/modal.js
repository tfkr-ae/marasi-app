// The Connections modal, registered as "Connections" in +layout.svelte's
// modalRegistery. Opened by the "Connections…" menu action, so the same key
// closes it.
export const connectionsModal = () => ({
  type: "component",
  component: "Connections",
  toggleAction: "global.connections",
});
