// The app's Start Chrome: the service client for the listener and the
// certificate, the connection store for the connection, and Go's
// StartBrowser for the launch (startChrome.js).
import { get } from "svelte/store";
import { StartBrowser } from "./bindings/github.com/tfkr-ae/marasi-app/app.js";
import { service } from "./service/index.js";
import { connectionStore } from "../stores/connectionStore.js";
import { createStartChrome } from "./startChrome.js";

export const startChrome = createStartChrome({
  client: service,
  connection: () => get(connectionStore),
  launch: (start) => StartBrowser(start),
});
