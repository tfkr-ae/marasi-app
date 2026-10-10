// Menu contexts: Marasi-defined pages and interface states that decide which
// menu actions are eligible. Each context has a tier; when several eligible
// contexts bind the same key, the most specific tier wins.
export const TIERS = ["overlay", "drawer", "page", "global"];

// Whether the request in a drawer's meta is a WebSocket upgrade, so its
// stream can be opened.
export function isWebSocketUpgrade(meta) {
  const response = meta?.incomingResponse || meta?.response;
  return (
    meta?.metadata?.protocol === "websocket" ||
    response?.StatusCode === 101 ||
    response?.ContentType === "websocket" ||
    Boolean(meta?.metadata?.["websocket.state"])
  );
}

const onRoute = (route) => (state) => state.route === route;
const drawerOpen = (state) => Boolean(state.drawer?.open);
const requestDrawerOpen = (state) =>
  drawerOpen(state) && state.drawer.id === "request-response";

// `isEligible(state)` receives the dispatcher state (see dispatcher.js). It is
// app-defined; profiles never change it. Ticket 04 adds overlay contexts here.
//
// A drawer that replaces its page's menu is expressed by eligibility: the
// page context is ineligible while the drawer is open, so its actions never
// run there, whatever the tier order. Drawers that only add a panel
// (Checkpoint and Compass logs, the Logbook report export) leave their page
// context eligible.
export const CONTEXTS = [
  {
    id: "global",
    tier: "global",
    label: "Global",
    isEligible: () => true,
  },
  {
    id: "ledger.drawer-closed",
    tier: "page",
    label: "Ledger",
    isEligible: (state) => onRoute("/ledger")(state) && !drawerOpen(state),
  },
  // Listed before ledger.drawer-open: both are drawer-tier and eligible
  // together on a WebSocket upgrade request, and table order breaks the tie.
  {
    id: "ledger.drawer-open.websocket",
    tier: "drawer",
    label: "Ledger drawer (WebSocket upgrade)",
    overlaps: ["ledger.drawer-open"],
    isEligible: (state) =>
      onRoute("/ledger")(state) &&
      drawerOpen(state) &&
      isWebSocketUpgrade(state.drawer.meta),
  },
  {
    id: "ledger.drawer-open",
    tier: "drawer",
    label: "Ledger drawer",
    isEligible: (state) => onRoute("/ledger")(state) && drawerOpen(state),
  },
  {
    id: "armory.page",
    tier: "page",
    label: "Armory",
    isEligible: (state) =>
      onRoute("/armory")(state) && !requestDrawerOpen(state),
  },
  {
    id: "armory.drawer",
    tier: "drawer",
    label: "Armory request drawer",
    isEligible: (state) =>
      onRoute("/armory")(state) && requestDrawerOpen(state),
  },
  ...[
    ["launchpad", "Launchpad"],
    ["checkpoint", "Checkpoint"],
    ["logbook", "Logbook"],
    ["compass", "Compass"],
    ["workshop", "Workshop"],
  ].map(([id, label]) => ({
    id,
    tier: "page",
    label,
    isEligible: onRoute(`/${id}`),
  })),
];

// Collision domains for validation. `overlaps` (optional, on either side)
// names same-tier contexts that can be eligible at the same time: precedence
// cannot pick between them, so a binding shared with one is a duplicate, like
// one shared within a context. Contexts that are mutually exclusive, or that
// overlap in a different tier (shadowing), stay separate. Mirrored by
// keybindingCatalog.conflicting in keybinding_validation.go.
export function contextsConflict(contexts, a, b) {
  if (a === b) return true;
  const byId = (id) => contexts.find((context) => context.id === id);
  return Boolean(byId(a)?.overlaps?.includes(b) || byId(b)?.overlaps?.includes(a));
}

export function tierRank(tier) {
  const rank = TIERS.indexOf(tier);
  if (rank === -1) throw new Error(`unknown menu context tier: ${tier}`);
  return rank;
}

// Ids of the contexts eligible in `state`, most specific first. Ties within a
// tier keep table order.
export function eligibleContextIds(state, contexts = CONTEXTS) {
  return contexts
    .filter((context) => context.isEligible(state))
    .map((context, index) => ({ context, index }))
    .sort(
      (a, b) =>
        tierRank(a.context.tier) - tierRank(b.context.tier) ||
        a.index - b.index,
    )
    .map(({ context }) => context.id);
}
