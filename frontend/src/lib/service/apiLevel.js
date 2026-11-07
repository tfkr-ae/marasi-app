// The control API levels this app supports. A service reports its API level
// as `api` in GET /service/status; Marasi raises it only when a route,
// field or event the app relies on goes away or changes meaning, never for
// an addition. Raise `max` once the app speaks a new level, and `min` once
// it stops speaking an old one. This is the one place the range lives
// (docs/agents/maps/marasi-service.md, "API level").
export const SUPPORTED_API = Object.freeze({ min: 1, max: 1 });

/**
 * The warning for a service at API level `api`, or null when the app
 * supports it. A status with no `api` comes from a Marasi older than API
 * levels, so it is too old.
 */
export function apiWarning(api, supported = SUPPORTED_API) {
  if (!Number.isInteger(api)) return "Service is too old for this app";
  if (api < supported.min) return `Service is too old for this app (API level ${api})`;
  if (api > supported.max) return `Service is newer than this app (API level ${api})`;
  return null;
}
