// The toasts for the event stream: a warning when it drops from connected,
// which stays until it is back, then a short "Reconnected" one. Feed it each
// connection state (createConnectionStore.js):
//
//   const update = createConnectionToasts(toastStore);
//   connectionStore.subscribe(update);

export function createConnectionToasts(toastStore) {
  let previous = null;
  let dropped = null;

  return function update(state) {
    const { phase } = state;
    const name = state.connection?.name ?? "Marasi";
    if (phase === "reconnecting" && previous === "connected") {
      dropped = toastStore.trigger({
        message: `Lost connection to ${name}. Reconnecting…`,
        background: "variant-filled-warning",
        autohide: false,
      });
    } else if (previous === "reconnecting" && phase !== "reconnecting") {
      if (dropped !== null) toastStore.close(dropped);
      dropped = null;
      if (phase === "connected" || phase === "project-changed") {
        toastStore.trigger({ message: `Reconnected to ${name}`, background: "variant-filled-success", timeout: 3000 });
      }
    }
    previous = phase;
  };
}
