// The connection store's api over the service client and the project
// store: the half connectionStore.js shares with the tests, since it
// imports no Wails bindings. connectionStore.js adds Go's half.
export function connectionServiceApi(client, projectStore) {
  return {
    // The control listener: sharing, the password and the allowed origins.
    // `link` is a bind() the store took (client.js): a call it outlived is
    // superseded, unsent.
    readControl: (link = client) => link.get("/service/control-listener/status"),
    updateControl: (body, link = client) => link.post("/service/control-listener/update", body),
    use: (connection) => client.use(connection),
    bind: () => client.bind(),
    readStatus: (options, link = client) => link.request("GET", "/service/status", options),
    // A new session: nothing the last one started reaches the next
    // connection. The client points nowhere until the session's use(), and
    // the project store's runs and opening screen end.
    sessionBegan: () => {
      client.use(null);
      projectStore.leave();
    },
    openEvents: (handlers) => client.openEvents(handlers),
    closeEvents: () => client.closeEvents(),
    // The project the service has open, whichever it is: the scratchpad on a
    // fresh instance, or what it had open when the app attached.
    loadProject: (status, options) => projectStore.loadService(status.project, options),
    loadDeclined: () => projectStore.closeFollowed(),
    reloadProject: (status, options) => projectStore.reload(status.project, options),
    holdWrites: (on) => client.holdWrites(on),
  };
}
