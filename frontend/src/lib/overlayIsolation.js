import { tick } from "svelte";
import { get } from "svelte/store";

const overlaySelector = "dialog[open], .drawer-backdrop, .modal-backdrop";
const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");
const preferredInputSelector = [
  'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([readonly]):not([disabled])',
  "textarea:not([readonly]):not([disabled])",
  "select:not([disabled])",
].join(",");

function getActiveOverlay({ modalOpen, drawerOpen }) {
  const dialogs = Array.from(document.querySelectorAll("dialog[open]"));
  if (dialogs.length) return dialogs[dialogs.length - 1];

  if (modalOpen) {
    const modals = Array.from(document.querySelectorAll(".modal-backdrop"));
    if (modals.length) return modals[modals.length - 1];
  }

  if (drawerOpen) {
    const drawers = Array.from(document.querySelectorAll(".drawer-backdrop"));
    return drawers[drawers.length - 1] || null;
  }

  return null;
}

function isModalToggleShortcut(event, modal) {
  const shortcut = modal.toggleShortcut;

  return Boolean(
    shortcut &&
      (event.metaKey || event.ctrlKey) &&
      event.altKey === Boolean(shortcut.altKey) &&
      event.shiftKey === Boolean(shortcut.shiftKey) &&
      event.key.toLowerCase() === shortcut.key,
  );
}

export function hasBlockingOverlay(modalStore) {
  return Boolean(
    get(modalStore).length || document.querySelector("dialog[open]"),
  );
}

function isVisible(element) {
  const style = getComputedStyle(element);
  return (
    style.visibility !== "hidden" &&
    style.display !== "none" &&
    element.getClientRects().length > 0
  );
}

function getFocusableElements(overlay) {
  return Array.from(overlay.querySelectorAll(focusableSelector)).filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.closest('[inert], [aria-hidden="true"]') &&
      isVisible(element),
  );
}

function focusInitially(element) {
  element.setAttribute("data-overlay-initial-focus", "");
  function handleBlur(event) {
    if (!event.relatedTarget && !document.hasFocus()) return;
    element.removeAttribute("data-overlay-initial-focus");
    element.removeEventListener("blur", handleBlur);
  }
  element.addEventListener("blur", handleBlur);
  element.focus();
}

function focusOverlay(overlay, initial = false) {
  if (overlay.contains(document.activeElement)) return;

  const target = getFocusableElements(overlay)[0];

  if (target) {
    if (initial) focusInitially(target);
    else target.focus();
    return;
  }

  const dialog = overlay.matches('[role="dialog"], dialog')
    ? overlay
    : overlay.querySelector('[role="dialog"]') || overlay;
  if (!dialog.hasAttribute("tabindex")) dialog.setAttribute("tabindex", "-1");
  if (initial) focusInitially(dialog);
  else dialog.focus();
}

function getPreferredInput(overlay) {
  return Array.from(overlay.querySelectorAll(preferredInputSelector)).find(
    (element) =>
      element.tabIndex >= 0 &&
      !element.closest('[inert], [aria-hidden="true"]') &&
      isVisible(element),
  );
}

function isEditable(element) {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element?.isContentEditable
  );
}

export function isolateOverlays(appRoot, stores) {
  let activeOverlay = null;
  let currentModal = null;
  let drawerOpen = false;
  let syncPending = false;
  let destroyed = false;
  let lastBackgroundFocus = document.activeElement;
  const lastOverlayFocus = new WeakMap();

  function syncOverlay() {
    const previousOverlay = activeOverlay;
    if (previousOverlay?.contains(document.activeElement)) {
      lastOverlayFocus.set(previousOverlay, document.activeElement);
    }
    activeOverlay = getActiveOverlay({
      modalOpen: Boolean(currentModal),
      drawerOpen,
    });

    for (const overlay of document.querySelectorAll(overlaySelector)) {
      overlay.inert = overlay !== activeOverlay;
    }

    appRoot.inert = Boolean(activeOverlay && !appRoot.contains(activeOverlay));
    for (const toast of document.querySelectorAll(".snackbar-wrapper")) {
      toast.inert = Boolean(activeOverlay);
    }

    if (activeOverlay === previousOverlay) return;

    const nextOverlay = activeOverlay;

    queueMicrotask(() => {
      if (activeOverlay !== nextOverlay) return;

      if (nextOverlay) {
        const previousFocus = lastOverlayFocus.get(nextOverlay);
        if (previousFocus?.isConnected) {
          if (previousFocus.tabIndex < 0) {
            focusInitially(previousFocus);
          } else {
            previousFocus.focus();
          }
        } else {
          const preferredInput = getPreferredInput(nextOverlay);
          if (preferredInput) {
            focusInitially(preferredInput);
          } else if (nextOverlay.contains(document.activeElement)) {
            focusInitially(document.activeElement);
          } else {
            focusOverlay(nextOverlay, true);
          }
        }
        if (nextOverlay.contains(document.activeElement)) {
          lastOverlayFocus.set(nextOverlay, document.activeElement);
        }
        return;
      }

      if (
        previousOverlay &&
        (document.activeElement === document.body ||
          previousOverlay.contains(document.activeElement)) &&
        lastBackgroundFocus?.isConnected
      ) {
        lastBackgroundFocus.focus();
      }
    });
  }

  function scheduleSync() {
    if (syncPending) return;
    syncPending = true;
    tick().then(() => {
      syncPending = false;
      if (!destroyed) syncOverlay();
    });
  }

  function handleFocusIn(event) {
    const overlay = activeOverlay;
    if (!overlay) {
      if (appRoot.contains(event.target)) lastBackgroundFocus = event.target;
      return;
    }

    if (overlay.contains(event.target)) {
      lastOverlayFocus.set(overlay, event.target);
    }
  }

  function handleKeydown(event) {
    const overlay = activeOverlay;
    if (!overlay) return;

    if (
      overlay.matches(".modal-backdrop") &&
      currentModal &&
      isModalToggleShortcut(event, currentModal)
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      stores.modalStore.close();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (overlay instanceof HTMLDialogElement) {
        const cancelEvent = new Event("cancel", { cancelable: true });
        if (overlay.dispatchEvent(cancelEvent)) overlay.close();
      } else if (overlay.matches(".modal-backdrop")) {
        currentModal?.response?.(false);
        stores.modalStore.close();
      } else {
        stores.drawerStore.close();
      }
      return;
    }

    if (event.key === "Tab" && overlay instanceof HTMLDialogElement) {
      const focusable = getFocusableElements(overlay);
      const currentIndex = focusable.indexOf(document.activeElement);
      const leavingForwards =
        !event.shiftKey && currentIndex === focusable.length - 1;
      const leavingBackwards = event.shiftKey && currentIndex === 0;

      if (currentIndex === -1 || leavingForwards || leavingBackwards) {
        event.preventDefault();
        const target = event.shiftKey
          ? focusable[focusable.length - 1]
          : focusable[0];
        if (target) target.focus();
        else focusOverlay(overlay);
      }
      return;
    }

    if (event.key === "Backspace" && !isEditable(event.target)) {
      event.preventDefault();
    }
  }

  const unsubscribeModal = stores.modalStore.subscribe((modals) => {
    currentModal = modals[0] || null;
    scheduleSync();
  });
  const unsubscribeDrawer = stores.drawerStore.subscribe((drawer) => {
    drawerOpen = drawer.open === true;
    scheduleSync();
  });
  const unsubscribeToast = stores.toastStore.subscribe(scheduleSync);
  const dialogObserver = new MutationObserver(scheduleSync);
  dialogObserver.observe(appRoot, {
    attributes: true,
    subtree: true,
    attributeFilter: ["open"],
  });
  document.addEventListener("focusin", handleFocusIn);
  window.addEventListener("keydown", handleKeydown, true);
  syncOverlay();

  return {
    destroy() {
      destroyed = true;
      unsubscribeModal();
      unsubscribeDrawer();
      unsubscribeToast();
      dialogObserver.disconnect();
      document.removeEventListener("focusin", handleFocusIn);
      window.removeEventListener("keydown", handleKeydown, true);
      appRoot.inert = false;
      for (const overlay of document.querySelectorAll(overlaySelector)) {
        overlay.inert = false;
      }
      for (const toast of document.querySelectorAll(".snackbar-wrapper")) {
        toast.inert = false;
      }
    },
  };
}
