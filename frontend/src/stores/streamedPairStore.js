// The app's streamed pair messages store over the service client. The logic
// lives in createStreamedPairStore.js and the API shapes in
// streamedPairApi.js; this file binds them to the app's client and routes
// the stream_message, stream_message.progress and streamed_pair.* events.
import { service } from "../lib/service/index.js";
import { createStreamedPairStore } from "./createStreamedPairStore.js";

export { canCancel, openDirections } from "./createStreamedPairStore.js";
import { projectData } from "./projectData.js";
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
  clear: streamedPairStore.clear,
  load: streamedPairStore.resync,
});

service.on("stream_message", (message) => streamedPairStore.onMessage(toStreamMessage(message)));
service.on("stream_message.progress", (progress) => streamedPairStore.onProgress(toStreamProgress(progress)));
// An inject Checkpoint intercepts shows "Intercepted in Checkpoint" in the Inject tab.
service.on("checkpoint.held", (item) => streamedPairStore.onCheckpointHeld(toHeldStreamItem(item)));
for (const name of STREAMED_PAIR_EVENTS) {
  service.on(name, (event) => streamedPairStore.onStreamedPair(toStreamedPairEvent(event)));
}
