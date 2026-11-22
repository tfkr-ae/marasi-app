// Whether a Ledger pair's messages can open in the Messages modal: a
// streamed pair (its row's streamed state, set from the moment it starts,
// so a live pair whose response hasn't started opens too), or a WebSocket
// upgrade whose connection can open. Pure JS, for contexts.js and the row
// menu.
import { canOpenDrawerStream, upgradeFromLedgerRow, upgradePresentation } from "../websocket/presentation.js";

/** A Ledger drawer's meta (drawerKeybindingState). */
export const canOpenDrawerMessages = (meta) => Boolean(meta?.streamed) || canOpenDrawerStream(meta);

/** A Ledger row. */
export const canOpenRowMessages = (row) =>
  Boolean(row?.Streamed) || upgradePresentation(upgradeFromLedgerRow(row)).canOpen;
