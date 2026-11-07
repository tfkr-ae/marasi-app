// A pairing payload, as `marasi service control pair --json` prints it and
// another app's Share copies it: {"url":"http://<host>:<port>",
// "password":"…" (omitted when none), "instance":"default"}.

/**
 * The remote connection `text` adds, `{name, url, password, noPassword}`.
 * Throws "That isn't a pairing payload" for anything else.
 */
export function parsePairing(text) {
  let payload;
  try {
    payload = JSON.parse(String(text).trim());
  } catch {
    payload = null;
  }
  let url = null;
  try {
    url = typeof payload?.url === "string" ? new URL(payload.url) : null;
  } catch {
    url = null;
  }
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new Error("That isn't a pairing payload");
  }
  const password = typeof payload.password === "string" ? payload.password : "";
  const instance = typeof payload.instance === "string" && payload.instance ? payload.instance : "marasi";
  return {
    name: `${instance} @ ${url.hostname}`,
    url: payload.url.trim().replace(/\/+$/, ""),
    password,
    noPassword: password === "",
  };
}
