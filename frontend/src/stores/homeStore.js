// Home's store over the service client. The logic is in createHomeStore.js
// and the API shapes in homeApi.js; this file binds them to the app's
// client and routes the stream's events to the store.
import { service } from "../lib/service/index.js";
import { createHomeApi } from "./homeApi.js";
import { createHomeStore } from "./createHomeStore.js";
import { listener } from "../stores.js";

export const homeStore = createHomeStore(createHomeApi(service));

service.on("log.added", homeStore.onLog);
service.on("listener.started", homeStore.onListener);
service.on("listener.updated", homeStore.onListener);
service.on("listener.stopped", homeStore.onListener);
service.on("job.complete", homeStore.onJobComplete);

// The listener modal still reads the shared `listener` store.
homeStore.subscribe((state) => listener.set(state.listener));
