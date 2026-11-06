// The service's refusals as errors the frontend's helpers already read.
// errorCodes.js's codeIDs matches "<what>: <code> (<id>, <id>): <cause>" or
// "<what>: <code>: <cause>", so a ServiceError's text takes that shape:
// "<METHOD> <path>: <code>[ (<ids>)]: <message>".
//
// Most codes pass through as the service names them. `renames` lists the
// refusals the app knew by another code; add a row when a page needs one.

/** A refused control API call. `code` is the code the frontend reads. */
export class ServiceError extends Error {
  constructor(message, { status, code, ids, body }) {
    super(message);
    this.name = "ServiceError";
    this.status = status;
    this.code = code;
    this.ids = ids;
    this.body = body;
  }
  toString() {
    return this.message;
  }
}

// Each row matches on the service code, method, path and status it names,
// and gives the app's code and the ids it names.
const renames = [
  // Another instance holds the project's lock.
  { code: "project_already_open", to: "project_locked" },
  // A held item already forwarded, dropped or abandoned.
  { method: "POST", path: /^\/checkpoint\/([^/]+)\/(?:forward|drop)$/, status: 404, to: "checkpoint_gone", ids: (m) => [m[1]] },
  // The entry was no longer in the launchpad (the service can't tell it
  // apart from a launchpad that's gone).
  { method: "DELETE", path: /^\/launchpad\/[^/]+\/link\/[^/]+$/, status: 404, to: "not_linked" },
];

// The ids a refusal's body names, by code.
function bodyIDs(code, body) {
  if (code === "launch_pending") return body?.request_ids ?? [];
  if (code === "selection_incomplete") return body?.jobs ?? [];
  return [];
}

/** Builds the ServiceError for `method path` answered `status` with `body`. */
export function serviceError({ method, path, status, body, text = "" }) {
  const what = `${method} ${path}`;
  const serviceCode = typeof body?.error === "string" ? body.error : "http_error";
  let code = serviceCode;
  let ids = bodyIDs(serviceCode, body);
  const bare = path.split("?")[0];
  for (const rename of renames) {
    if (rename.code && rename.code !== serviceCode) continue;
    if (rename.method && rename.method !== method) continue;
    if (rename.status && rename.status !== status) continue;
    const match = rename.path ? rename.path.exec(bare) : [];
    if (!match) continue;
    code = rename.to;
    ids = rename.ids ? rename.ids(match) : [];
    break;
  }
  const detail = body ? body.message : text.trim();
  const cause = detail || `HTTP ${status}`;
  const named = ids.length ? `${code} (${ids.join(", ")})` : code;
  const message = code === "http_error" ? `${what}: ${named}: HTTP ${status}${detail ? ` ${detail}` : ""}` : `${what}: ${named}: ${cause}`;
  return new ServiceError(message, { status, code, ids, body });
}
