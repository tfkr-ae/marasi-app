// Whether a Ledger pair's messages can open in the Messages modal: a
// streamed pair (its row's streamed state, set from the moment it starts,
// so a live pair whose response hasn't started opens too), or a WebSocket
// upgrade whose connection can open. A service without `streamed` on rows
// gives no streamed state: such a pair opens once its full read shows its
// streamed metadata (the Ledger store's `streamedRead`). Pure JS, for
// contexts.js, the row menus and the Logbook.
import { canOpenDrawerStream, upgradeFromLedgerRow, upgradeFromRequest, upgradePresentation } from "../websocket/presentation.js";
import { MESSAGES_MODAL } from "./kinds.js";

/** Whether a pair's full read (toDetails) shows its streamed state or metadata. */
export const fullReadStreamed = (details) => Boolean(details?.Streamed || details?.Metadata?.streamed);

/** A Ledger drawer's meta (drawerKeybindingState). */
export const canOpenDrawerMessages = (meta) => Boolean(meta?.streamed) || canOpenDrawerStream(meta);

/** A Ledger row; `streamedRead` is the pair whose full read showed streamed metadata. */
export const canOpenRowMessages = (row, { streamedRead = null } = {}) =>
  Boolean(row?.Streamed) ||
  (streamedRead != null && String(row?.ID) === String(streamedRead)) ||
  upgradePresentation(upgradeFromLedgerRow(row)).canOpen;

/**
 * Whether a pair's full read (toDetails, or the Launchpad's raw details)
 * opens in the Messages modal: a streamed pair, or a WebSocket upgrade whose
 * connection can open. For the Launchpad and the Logbook, which have no
 * drawer meta.
 */
export const canOpenPairMessages = (details) =>
  fullReadStreamed(details) ||
  upgradePresentation(
    upgradeFromRequest({ Metadata: details?.Metadata, Response: details?.Response ?? undefined }),
  ).canOpen;

/**
 * The Messages modal's settings for pair `pairId`: its stream messages when
 * `streamed`, else the WebSocket connection of the upgrade in `details`
 * (a full read), as the Ledger opens them.
 */
export function messagesModal(pairId, { streamed = false, details = null } = {}) {
  if (streamed || fullReadStreamed(details)) {
    return { type: "component", component: MESSAGES_MODAL, meta: { kind: "stream", pairId } };
  }
  return {
    type: "component",
    component: MESSAGES_MODAL,
    meta: {
      upgradeRequest: structuredClone({
        Metadata: details?.Metadata,
        Request: details?.Request,
        Response: details?.Response,
      }),
    },
  };
}
