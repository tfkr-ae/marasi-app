/**
 * Shows an error toast: `message`, then ": <error>" when there is an error,
 * such as "Failed to save the query: disk full".
 */
export function toastError(toastStore, message, error) {
  toastStore.trigger({
    message: error ? `${message}: ${String(error)}` : message,
    background: "variant-filled-error",
  });
}

/** The toast style for handoffs to another page, in light or dark mode. */
export function handoffBackground(light) {
  return light ? "bg-surface-50 text-surface-900 border border-surface-300" : "bg-surface-100 text-surface-900";
}

/**
 * Shows a handoff toast whose `label` button closes it and calls `go`,
 * which leaves for another page.
 */
export function toastJump(toastStore, message, label, light, go) {
  const toastId = toastStore.trigger({
    message,
    background: handoffBackground(light),
    action: {
      label,
      response: () => {
        toastStore.close(toastId);
        go();
      },
    },
  });
}
