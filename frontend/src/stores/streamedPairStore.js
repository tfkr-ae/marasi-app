// The app's streamed pair messages store over the service client. The logic
// lives in createStreamedPairStore.js and the API shapes in
// streamedPairApi.js; this file binds them to the app's client and routes
// the stream_message, stream_message.progress and streamed_pair.* events,
// batched (eventBatch.js).
import { service } from "../lib/service/index.js";
import { createStreamedPairStore } from "./createStreamedPairStore.js";
import { eventBatch } from "./eventBatch.js";

export { canCancel, openDirections } from "./createStreamedPairStore.js";
import { projectData } from "./projectData.js";
import { loadSignals } from "../lib/openProgress.js";
import {
  createStreamedPairApi,
  toHeldStreamItem,
  toStreamedPairEvent,
  toStreamMessage,
  toStreamProgress,
} from "./streamedPairApi.js";
import { STREAMED_PAIR_EVENTS } from "./trafficApi.js";

export const streamedPairStore = createStreamedPairStore(createStreamedPairApi(service));

projectData.register("streamed-pairs", {
  signal: loadSignals.traffic,
  clear: streamedPairStore.clear,
  load: streamedPairStore.resync,
});

// A fast stream's events land in the store a batch at a time, in order.
const live = eventBatch(streamedPairStore.onEvents);
service.on("stream_message", (message) => live({ message: toStreamMessage(message) }));
service.on("stream_message.progress", (progress) => live({ progress: toStreamProgress(progress) }));
// An inject Checkpoint intercepts shows "Intercepted in Checkpoint" in the Inject tab.
service.on("checkpoint.held", (item) => streamedPairStore.onCheckpointHeld(toHeldStreamItem(item)));
for (const name of STREAMED_PAIR_EVENTS) {
  service.on(name, (event) => live({ streamedPair: toStreamedPairEvent(event) }));
}
