// The app's Checkpoint store, bound to the Wails backend. The logic lives in
// createCheckpointStore.js, which tests load with a fake API.
import {
  CheckHTTPParse,
  DropCheckpoint,
  DropCheckpoints,
  ForwardCheckpoint,
  ForwardCheckpoints,
  GetCheckpointItems,
  GetInterceptFlag,
  GetRawDetails,
  GetWebSocketConnection,
  ToggleIntercept,
} from "../lib/wailsjs/go/main/App";
import { createItemContext } from "../lib/checkpoint/itemContext.js";
import { createCheckpointStore } from "./createCheckpointStore.js";
import { interceptFlag } from "./interceptFlag.js";

export {
  isChecking,
  isDirty,
  parseErrorOf,
  pickedIds,
  textOf,
} from "./createCheckpointStore.js";

export const checkpointStore = createCheckpointStore(
  {
    getItems: () => GetCheckpointItems(),
    checkParse: (text, type) => CheckHTTPParse(text, type),
    forward: (id, body, interceptResponse) => ForwardCheckpoint(id, body, interceptResponse),
    drop: (id) => DropCheckpoint(id),
    forwardMany: (items) => ForwardCheckpoints(items),
    dropMany: (ids) => DropCheckpoints(ids),
    getInterceptFlag: () => GetInterceptFlag(),
    toggleIntercept: () => ToggleIntercept(),
  },
  { interceptFlag },
);

// The held items' context (a response's request, a WebSocket message's
// connection), read once per item. The layout loads it for every held item,
// so the page and the abandon toast share it.
export const checkpointItemContext = createItemContext({
  getRow: (id) => GetRawDetails(id),
  getConnection: (id) => GetWebSocketConnection(id),
});
