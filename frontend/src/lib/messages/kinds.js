// The Messages modal's kinds: what each kind of message source (a WebSocket
// connection or a streamed pair) gives the shared modal that the keybinding layer
// also needs. Pure JS, so contexts.js and `node --test` can use it; the
// kind's components, icons and handlers are in its Svelte-side definition
// (lib/messages/<kind>.js, such as stream.js, listed in definitions.js).
//
// A kind names its menu contexts: one shared by every tab (`context`) and
// one per tab (`<context>.<tab>`). Context and action ids never change once
// shipped (docs/adr/2026-10-11-websocket-action-ids-keep-frame.md).

// The modal's registered name (`modalRegistery` in +layout.svelte). Kept from
// when the modal showed only WebSocket connections.
export const MESSAGES_MODAL = "WebsocketStream";

export const MESSAGE_KINDS = {
  websocket: {
    id: "websocket",
    // The menu's page heading and the contexts' page name.
    page: "WebSocket",
    context: "websocket",
    // Where the dispatcher state carries the open tab (app.js publishes it).
    tabState: "websocketTab",
    tabs: [
      { id: "stream", label: "Stream" },
      { id: "checkpoint", label: "Checkpoint" },
      { id: "inject", label: "Inject" },
      { id: "connection", label: "Connection" },
    ],
  },
  // A streamed pair (GLOSSARY Streamed pair). Its action ids say "message".
  stream: {
    id: "stream",
    page: "Streamed pair",
    context: "stream",
    tabState: "streamTab",
    tabs: [
      { id: "messages", label: "Messages" },
      { id: "checkpoint", label: "Checkpoint" },
      { id: "inject", label: "Inject" },
      { id: "pair", label: "Pair" },
    ],
  },
};

// The kind a modal's meta asks for. A modal opened without one (every
// opener before the modal took kinds) shows a WebSocket connection.
export function kindOf(meta) {
  return MESSAGE_KINDS[meta?.kind] ?? MESSAGE_KINDS.websocket;
}

// Whether the Messages modal shows `kind`. The dispatcher state names the
// open modal's kind (`messagesKind`, from its meta through kindOf) from the
// moment it opens, before the modal publishes its open tab. Without it, the
// kind is the one whose tabState is published, and a modal with no other
// kind's tab published shows a WebSocket connection, as kindOf does.
function kindShown(kind, state) {
  if (state.modal !== MESSAGES_MODAL) return false;
  if (state.messagesKind) return state.messagesKind === kind.id;
  if (state[kind.tabState] != null) return true;
  return kind === MESSAGE_KINDS.websocket && Object.values(MESSAGE_KINDS).every((k) => state[k.tabState] == null);
}

// The tab `step` places after `tab` among the kind's tabs (negative steps go
// back), wrapping around: what the previous-tab and next-tab actions move to.
export function stepTab(kind, tab, step) {
  const ids = kind.tabs.map((t) => t.id);
  const index = Math.max(ids.indexOf(tab), 0);
  return ids[(((index + step) % ids.length) + ids.length) % ids.length];
}

// The kind's menu contexts: actions shared by every tab, then one context per
// tab. Each tab is eligible together with the shared context in the same
// tier, so they overlap (one collision domain); the tabs never co-occur, so
// they may reuse keys. Beneath the modal only the global context stays
// eligible: that is shadowing across tiers and needs no declaration.
export function kindContexts(kind) {
  const open = (state) => kindShown(kind, state);
  return [
    {
      id: kind.context,
      tier: "overlay",
      label: kind.page,
      page: kind.page,
      state: "Every tab",
      isEligible: open,
    },
    ...kind.tabs.map((tab) => ({
      id: `${kind.context}.${tab.id}`,
      tier: "overlay",
      label: `${kind.page} ${tab.label} tab`,
      page: kind.page,
      state: `${tab.label} tab`,
      overlaps: [kind.context],
      isEligible: (state) => open(state) && state[kind.tabState] === tab.id,
    })),
  ];
}

// A message row's direction arrow: up for the request (client) direction,
// down for the response (server) one. Response arrows are surface-coloured
// in light mode, where secondary is too pale to see, and secondary in dark
// mode. Literal strings so Tailwind's content scan keeps them.
// `glyph` is the arrow as text, for a label or a chip.
export function directionArrow(outgoing) {
  return outgoing
    ? { up: true, glyph: "↑", class: "text-primary-500" }
    : { up: false, glyph: "↓", class: "text-surface-600 dark:text-secondary-500" };
}
