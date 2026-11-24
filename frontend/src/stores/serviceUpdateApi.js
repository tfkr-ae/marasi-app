// The service update API adapter over the service client: the control API
// routes for inspecting, checking, installing, and cancelling a connected
// service's own update (service/update_routes.go). Each call accepts a bound
// link from `bind()` so connection switches supersede in-flight calls cleanly.
export function createServiceUpdateApi(client) {
  return {
    bind: () => client.bind(),
    getUpdate: (link = client) => link.get("/update"),
    checkUpdate: (link = client) => link.post("/update/check"),
    installUpdate: (link = client) => link.post("/update/install"),
    cancelInstall: (link = client) => link.del("/update/install"),
  };
}
