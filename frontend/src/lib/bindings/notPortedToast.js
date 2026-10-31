import { get } from "svelte/store";
import { isNotPorted } from "./notPorted.js";

const message = "Not ported yet";

/**
 * Shows a short toast for a not ported call nobody handled, unless one is
 * already showing, so a page that makes many calls shows one. Returns
 * whether `error` was a not ported rejection.
 */
export function toastNotPorted(toastStore, error) {
  if (!isNotPorted(error)) return false;
  if (!get(toastStore).some((toast) => toast.message === message)) {
    toastStore.trigger({ message, background: "variant-filled-warning" });
  }
  return true;
}
