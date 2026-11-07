// The app's service client, over the browser's fetch and the fetch-based
// EventSource (sse.js). Stores build their `api` from it (see
// docs/agents/maps/marasi-service.md, "Adding a store to the service client").
import { createServiceClient } from "./client.js";
import { createFetchEventSource } from "./sse.js";

const browserFetch = (...args) => globalThis.fetch(...args);

export const service = createServiceClient({
  fetch: browserFetch,
  EventSource: createFetchEventSource(browserFetch),
});

export { ServiceError } from "./errors.js";
