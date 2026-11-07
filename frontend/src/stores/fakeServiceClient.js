// A fake service client for the store suites (not used by the app): routes
// map "METHOD /path" to a body, or to a function of (query, body) returning
// one. A missing route, or an answer { status >= 400, body }, refuses as the
// service would, with the ServiceError the real client throws. Calls are
// recorded as { method, path, query, body }.
import { serviceError } from "../lib/service/errors.js";

export function fakeServiceClient(routes) {
  const calls = [];
  async function request(method, path, { query, body } = {}) {
    calls.push({ method, path, query, body });
    let answer = routes[`${method} ${path}`];
    if (answer === undefined) answer = { status: 404, body: { error: "not_found" } };
    if (typeof answer === "function") answer = await answer(query ?? {}, body);
    if (answer && typeof answer.status === "number" && answer.status >= 400) {
      throw serviceError({ method, path, status: answer.status, body: answer.body });
    }
    return answer;
  }
  return {
    calls,
    get: (path, query) => request("GET", path, { query }),
    post: (path, body, query) => request("POST", path, { body, query }),
    put: (path, body, query) => request("PUT", path, { body, query }),
    del: (path, body, query) => request("DELETE", path, { body, query }),
  };
}
