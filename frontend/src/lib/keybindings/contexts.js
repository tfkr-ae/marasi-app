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

// A page (and its drawers) is eligible on its route while no modal covers
// it. Only the WebSocket modal lets menu actions through the gate; under it,
// its own overlay contexts and the global context are eligible, never the
// page or drawer beneath.
const onRoute = (route) => (state) => state.route === route && !state.modal;
const drawerOpen = (state) => Boolean(state.drawer?.open);
const requestDrawerOpen = (state) =>
  drawerOpen(state) && state.drawer.id === "request-response";

export const WEBSOCKET_MODAL = "WebsocketStream";
// The WebSocket modal's tabs, in tab order. The modal publishes the open one
// as `state.websocketTab`.
export const WEBSOCKET_TABS = ["stream", "checkpoint", "inject"];
const websocketModalOpen = (state) => state.modal === WEBSOCKET_MODAL;

// `isEligible(state)` receives the dispatcher state (see dispatcher.js). It is
// app-defined; profiles never change it.
//
// `coOccursWith` lists the other contexts that can be eligible at the same
// time as this one (the relation is symmetric; declaring it on one side is
// enough, and the global context co-occurs with every context implicitly).
// Validation uses it with tiers: co-occurring contexts of the same tier form
// one collision domain (a key may not be bound twice across them), and a
// more specific co-occurring context shadows a broader one. Contexts that
// never co-occur may reuse keys freely.
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
  // The WebSocket modal: actions shared by every tab, then one context per
  // tab. A tab context and the shared one are eligible together.
  {
    id: "websocket",
    tier: "overlay",
    label: "WebSocket",
    isEligible: websocketModalOpen,
    coOccursWith: WEBSOCKET_TABS.map((tab) => `websocket.${tab}`),
  },
  ...[
    ["stream", "WebSocket Stream tab"],
    ["checkpoint", "WebSocket Checkpoint tab"],
    ["inject", "WebSocket Inject tab"],
  ].map(([tab, label]) => ({
    id: `websocket.${tab}`,
    tier: "overlay",
    label,
    isEligible: (state) => websocketModalOpen(state) && state.websocketTab === tab,
  })),
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
    isEligible: (state) =>
      onRoute("/ledger")(state) &&
      drawerOpen(state) &&
      isWebSocketUpgrade(state.drawer.meta),
    coOccursWith: ["ledger.drawer-open"],
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

function decodedRoute(route) {
  try {
    return decodeURIComponent(route ?? "");
  } catch {
    return route;
  }
}

// An extension's page, `/extension/<name>`. Built per loaded extension (see
// buildCatalog), so it is not in CONTEXTS.
export function extensionPageContext(id, extensionName) {
  return {
    id,
    tier: "page",
    label: extensionName,
    isEligible: (state) =>
      !state.modal && decodedRoute(state.route) === `/extension/${extensionName}`,
  };
}

export function tierRank(tier) {
  const rank = TIERS.indexOf(tier);
  if (rank === -1) throw new Error(`unknown menu context tier: ${tier}`);
  return rank;
}

// Whether two contexts can be eligible at the same time: the same context,
// either one is global, or either declares the other in `coOccursWith`.
export function contextsCoOccur(a, b, contexts = CONTEXTS) {
  if (a === b) return true;
  const byId = (id) => contexts.find((context) => context.id === id);
  const [first, second] = [byId(a), byId(b)];
  if (first?.tier === "global" || second?.tier === "global") return true;
  return Boolean(
    first?.coOccursWith?.includes(b) || second?.coOccursWith?.includes(a),
  );
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
