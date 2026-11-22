// Whether a Ledger pair's messages can open in the Messages modal: a
// streamed pair (its row's streamed state, set from the moment it starts,
// so a live pair whose response hasn't started opens too), or a WebSocket
// upgrade whose connection can open. A service without `streamed` on rows
// gives no streamed state: such a pair opens once its full read shows its
// streamed metadata (the Ledger store's `streamedRead`). Pure JS, for
// contexts.js and the row menu.
import { canOpenDrawerStream, upgradeFromLedgerRow, upgradePresentation } from "../websocket/presentation.js";

/** Whether a pair's full read (toDetails) shows streamed metadata. */
export const fullReadStreamed = (details) => Boolean(details?.Metadata?.streamed);

/** A Ledger drawer's meta (drawerKeybindingState). */
export const canOpenDrawerMessages = (meta) => Boolean(meta?.streamed) || canOpenDrawerStream(meta);

/** A Ledger row; `streamedRead` is the pair whose full read showed streamed metadata. */
export const canOpenRowMessages = (row, { streamedRead = null } = {}) =>
  Boolean(row?.Streamed) ||
  (streamedRead != null && String(row?.ID) === String(streamedRead)) ||
  upgradePresentation(upgradeFromLedgerRow(row)).canOpen;
