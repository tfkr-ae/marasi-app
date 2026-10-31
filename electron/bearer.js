// Adds a window's control token to its requests, outside the page, so the
// renderer never holds it (docs/adr/2026-10-31-v2-reaches-marasi-only-through-the-control-api.md).

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * The headers to send for `details` (a session's onBeforeSendHeaders
 * details): its own, plus `Authorization: Bearer <token>` when it goes to
 * the origin of the connection `connectionOf(webContentsId)` returns
 * (`{origin, token}`, or null for a window with none).
 */
export function withBearer(details, connectionOf) {
  const connection = details.webContentsId == null ? null : connectionOf(details.webContentsId);
  if (!connection || originOf(details.url) !== connection.origin) return details.requestHeaders;
  const headers = Object.fromEntries(
    Object.entries(details.requestHeaders).filter(([name]) => name.toLowerCase() !== "authorization"),
  );
  headers.Authorization = `Bearer ${connection.token}`;
  return headers;
}
