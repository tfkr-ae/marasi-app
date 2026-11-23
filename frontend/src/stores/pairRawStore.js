// The raw messages of the pairs on cards (createPairRawStore.js) over the
// service client. A response arriving reaches it through the pair's row
// (pairRowsStore.js): the card asks again with the row that shows it.
import { service } from "../lib/service/index.js";
import { createToolTrafficApi } from "./toolTrafficApi.js";
import { createPairRawStore } from "./createPairRawStore.js";
import { projectData } from "./projectData.js";

export const pairRaw = createPairRawStore(createToolTrafficApi(service));

// The cards remount after a load and ask again.
projectData.register("pairRaw", { clear: pairRaw.clear, load: () => {} });
