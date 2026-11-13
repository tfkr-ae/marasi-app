// What the Connections modal shows, and the pairing scanner's messages. The
// iOS app can't run the Marasi CLI, so it offers no Local connection: adding
// one is scanning a pairing QR code (or entering it by hand), and with no
// remote saved yet the modal is only that.

/**
 * The modal's contents for `picked` (a connection id, or "add"):
 * `{listed, showList, pane, connection}`. `pane` is "detail" (the picked
 * connection, `connection`), "add" (the desktop add form) or "pair" (the
 * iOS scanner with its manual form).
 */
export function connectionsView({ mobile, connections, picked }) {
  const listed = mobile ? connections.filter((c) => c.kind !== "local") : connections;
  const connection = listed.find((c) => c.id === picked) ?? null;
  if (mobile) {
    const pairing = picked === "add" || connection === null;
    return { listed, showList: listed.length > 0, pane: pairing ? "pair" : "detail", connection };
  }
  if (picked === "add") return { listed, showList: true, pane: "add", connection: null };
  return { listed, showList: true, pane: "detail", connection: connection ?? listed[0] };
}

const scanErrors = {
  "camera-denied": "Camera access is off. Allow it in Settings, or enter it manually.",
  "no-camera": "No camera found. Enter it manually.",
  "camera-failed": "The camera didn't start. Enter it manually.",
};

/** The line the scanner shows for the native side's failure `reason`. */
export const scanErrorText = (reason) => scanErrors[reason] ?? `The camera didn't start (${reason}).`;

/** The box a DOMRect gives, as StartQRScan and MoveQRScan take it. */
export const scanRect = (r) => ({ x: r.left, y: r.top, width: r.width, height: r.height });

/** Whether two boxes differ by half a pixel or more. */
export const rectMoved = (a, b) =>
  !a || !b || ["x", "y", "width", "height"].some((k) => Math.abs(a[k] - b[k]) >= 0.5);
