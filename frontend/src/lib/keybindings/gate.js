// Whether a key event may run menu actions at all, before any binding is
// looked up. Returns:
// - "blocked": no menu action runs.
// - "menu-only": only global.open-menu runs (it closes the open menu).
// - "open": every eligible action may run.
//
// `state` is the dispatcher state: { route, modal, dialogOpen, ... }.
// Ticket 06 extends this with unmodified-key suppression in editable targets
// and IME composition.

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

export function shortcutGate(event, state) {
  if (state.modal && !NON_BLOCKING_MODALS.has(state.modal)) return "blocked";
  if (blockedByFormField(event, state)) return "blocked";
  // An open <dialog> without a modal is the Marasi menu itself.
  if (!state.modal && state.dialogOpen) return "menu-only";
  return "open";
}
