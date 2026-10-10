// Menu contexts: Marasi-defined pages and interface states that decide which
// menu actions are eligible. Each context has a tier; when several eligible
// contexts bind the same key, the most specific tier wins.
export const TIERS = ["overlay", "drawer", "page", "global"];

// `isEligible(state)` receives the dispatcher state (see dispatcher.js). It is
// app-defined; profiles never change it. Tickets 03/04 add page, drawer and
// overlay contexts here.
export const CONTEXTS = [
  {
    id: "global",
    tier: "global",
    label: "Global",
    isEligible: () => true,
  },
];

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
