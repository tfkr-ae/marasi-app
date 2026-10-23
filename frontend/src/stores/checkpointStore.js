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
  ToggleIntercept,
} from "../lib/wailsjs/go/main/App";
import { createCheckpointStore } from "./createCheckpointStore.js";
import { interceptFlag } from "./interceptFlag.js";

export {
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
