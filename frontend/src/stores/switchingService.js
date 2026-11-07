// The real service client over a fake fetch that serves two connections,
// for the switch suites (not used by the app). The client starts on A
// (http://a:9000). `routes` maps "METHOD /path" to an answer body, or to a
// function of (body, request) returning one; a missing route answers {}.
// `switchWhen("METHOD /path")` moves the client to B (http://b:9000) as that
// request's answer comes back, so the answer lands after the switch, as
// when the user switches while it is on its way. `switchNow()` moves it at
// once. `requests` records { method, host, path, body } in order.
import { createServiceClient } from "../lib/service/client.js";

export const A = { url: "http://a:9000", password: "pw-a" };
export const B = { url: "http://b:9000", password: "pw-b" };

export function switchingService(routes = {}) {
  const requests = [];
  let trigger = null;
  const fetch = async (url, init = {}) => {
    const at = new URL(url);
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    const request = { method, host: at.host, path: at.pathname, body };
    requests.push(request);
    const key = `${method} ${at.pathname}`;
    let answer = routes[key] ?? {};
    if (typeof answer === "function") answer = answer(body, request);
    if (trigger === key) {
      trigger = null;
      client.use(B);
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify(answer ?? {}),
      arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(answer ?? {})).buffer,
    };
  };
  const client = createServiceClient({ fetch, EventSource: class { addEventListener() {} close() {} } });
  client.use(A);
  return {
    client,
    requests,
    switchWhen: (key) => (trigger = key),
    switchNow: () => client.use(B),
    /** The requests that reached B, as "METHOD /path". */
    onB: () => requests.filter((r) => r.host === "b:9000").map((r) => `${r.method} ${r.path}`),
    /** The requests that reached A, as "METHOD /path". */
    onA: () => requests.filter((r) => r.host === "a:9000").map((r) => `${r.method} ${r.path}`),
  };
}
