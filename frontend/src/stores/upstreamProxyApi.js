// Upstream proxies' api over the service client, in the shape
// createUpstreamProxyStore reads. The list is the service host's, the
// selection the open project's. Writes answer with the items alone, so each
// reads the list again for the selection, as the Go binding did.

const entry = (name) => `/upstream-proxy/${encodeURIComponent(name)}`;

/**
 * The update body for `name`: a new URL when one is given, and the CA
 * replaced, or removed (null) when `removeCA`. Refuses an update that
 * changes nothing.
 */
export function upstreamProxyUpdate(url, ca, removeCA) {
  const body = {};
  if (url) body.url = url;
  if (removeCA) body.ca = null;
  else if (ca) body.ca = ca;
  if (Object.keys(body).length === 0) throw new Error("upstream proxy update: nothing to change");
  return body;
}

export function createUpstreamProxyApi(client) {
  const list = () => client.get("/upstream-proxy");
  return {
    list,
    async add(name, url, ca) {
      // The service refuses an empty CA; leave it out.
      await client.post("/upstream-proxy", ca ? { name, url, ca } : { name, url });
      return list();
    },
    async update(name, url, ca, removeCA) {
      const body = upstreamProxyUpdate(url, ca, removeCA);
      await client.post(entry(name), body);
      return list();
    },
    async remove(name) {
      await client.del(entry(name));
      return list();
    },
    async use(name) {
      await client.put("/upstream-proxy-selection", { name });
      return list();
    },
    check: (name, target) => client.post(`${entry(name)}/check`, { target }),
  };
}
