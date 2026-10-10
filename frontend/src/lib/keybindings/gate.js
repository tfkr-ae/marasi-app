// Whether a key event may run menu actions at all, before any binding is
// looked up. Returns:
// - "blocked": no menu action runs.
// - "menu-only": only global.open-menu runs (it closes the open menu).
// - "open": every eligible action may run.
//
// `state` is the dispatcher state: { route, modal, dialogOpen, ... }.
//
// Typing suppression: a binding without meta, ctrl or alt (Shift alone does
// not count) never runs while focus is in an editable target, on any route.
// Modified shortcuts keep the per-route form-field rules below, and editors
// such as CodeMirror keep the keys they handle themselves (Vim mode).
import { bindingFromEvent, isModifiedBinding } from "./keys.js";

// Modals whose own menu actions run through the dispatcher while they are
// open (the WebSocket modal is an overlay menu context).
export const NON_BLOCKING_MODALS = new Set(["WebsocketStream"]);

// Routes where modified shortcuts also fire from inside form fields.
const FORM_FIELD_ROUTES = new Set(["/ledger", "/logbook"]);
const FORM_FIELD_TAGS = new Set(["INPUT", "SELECT", "TEXTAREA"]);
// The Marasi menu's own search field.
const MENU_SEARCH_ID = "commandmenu";

function blockedByFormField(event, state) {
  if (FORM_FIELD_ROUTES.has(state.route)) return false;
  const target = event.target;
  if (!target || !FORM_FIELD_TAGS.has(target.tagName)) return false;
  return target.id !== MENU_SEARCH_ID;
}

// Inputs, textareas, selects, contenteditable hosts and editor surfaces.
// CodeMirror's content is contenteditable; `.cm-editor` also covers focus on
// the editor's wrapper elements.
function isEditable(target) {
  if (!target) return false;
  if (FORM_FIELD_TAGS.has(target.tagName) || target.isContentEditable) return true;
  return Boolean(target.closest?.(".cm-editor"));
}

// Escape-to-close/cancel, Tab/Shift+Tab focus traversal and dialog or query
// Enter (with or without Shift) belong to the page, never to a menu action.
// Validation (05) and capture (07) can use this to refuse them as bindings.
const INTERACTION_KEYS = new Set(["escape", "tab", "enter"]);

export function isReservedBinding(binding) {
  if (!binding || isModifiedBinding(binding)) return false;
  return INTERACTION_KEYS.has(binding.replace(/^shift\+/, ""));
}

// Unmodified keys are left to the page: always for interaction keys, and for
// every key while the researcher is typing.
function unmodifiedKeyBelongsToPage(event) {
  const binding = bindingFromEvent(event);
  if (!binding || isModifiedBinding(binding)) return false;
  return isReservedBinding(binding) || isEditable(event.target);
}

export function shortcutGate(event, state) {
  // The keybindings settings modal is recording a shortcut.
  if (state.capturing) return "blocked";
  if (state.modal && !NON_BLOCKING_MODALS.has(state.modal)) return "blocked";
  if (blockedByFormField(event, state)) return "blocked";
  if (unmodifiedKeyBelongsToPage(event)) return "blocked";
  // An open <dialog> without a modal is the Marasi menu itself.
  if (!state.modal && state.dialogOpen) return "menu-only";
  return "open";
}
