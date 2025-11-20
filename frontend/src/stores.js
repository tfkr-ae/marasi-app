import { writable } from "svelte/store";
import {
  GetProxyItems,
  GetLogs,
  GetMarasiConfig,
  GetFilters,
  GetExtensionCode,
  GetWaypoints,
  GetInterceptFlag,
} from "./lib/wailsjs/go/main/App";

const canUseStorage =
  typeof window !== "undefined" && typeof window.localStorage !== "undefined";

function createPersistentStore(key, initialValue) {
  const store = writable(initialValue);
  if (canUseStorage) {
    const storedValue = window.localStorage.getItem(key);
    if (storedValue) {
      try {
        store.set(JSON.parse(storedValue));
      } catch (error) {
        console.error(`Failed to parse stored value for ${key}`, error);
      }
    } else {
      window.localStorage.setItem(key, JSON.stringify(initialValue));
    }
    store.subscribe((value) => {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch (storageError) {
        console.error(`Failed to persist store ${key}`, storageError);
      }
    });
  }
  return store;
}

function generateFilterId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `filter-${Math.random().toString(36).slice(2, 10)}`;
}

const defaultRequestFilters = [
  {
    id: "base64-url-hunter",
    name: "Base64 URL Hunter",
    description:
      "Flags when request or response bodies contain base64 strings that decode to URLs.",
    expression:
      "hasBase64Url(request.body) OR hasBase64Url(response.body)",
    defaultAction: "highlight",
    color: "#f97316",
  },
  {
    id: "reflection-detector",
    name: "Reflection Detector",
    description:
      "Shows requests whose parameters or cookies are reflected in the response body.",
    expression:
      "reflects(request.params, response.body) OR reflects(request.cookies, response.body)",
    defaultAction: "include",
    color: "#84cc16",
  },
];

// Ledger Stores
export const searchInput = writable("");
export const proxyItems = writable({});
export const filterItems = writable([]);
export const filterInput = writable("");
export const httpqlQuery = createPersistentStore(
  "marasi.httpqlQuery",
  "",
);
export const requestFilters = createPersistentStore(
  "marasi.requestFilters",
  defaultRequestFilters.map((filter) => ({ ...filter })),
);
export const requestFilterSelections = createPersistentStore(
  "marasi.requestFilterSelections",
  [],
);

export function upsertRequestFilter(filter) {
  const normalized = {
    id: filter.id ?? generateFilterId(),
    name: filter.name?.trim() || "Untitled Filter",
    description: filter.description?.trim() || "",
    expression: filter.expression || "",
    defaultAction: ["include", "exclude", "highlight"].includes(
      filter.defaultAction,
    )
      ? filter.defaultAction
      : "exclude",
    color: filter.color || "#6366f1",
  };
  requestFilters.update((items) => {
    const index = items.findIndex((item) => item.id === normalized.id);
    if (index >= 0) {
      const clone = [...items];
      clone[index] = normalized;
      return clone;
    }
    return [...items, normalized];
  });
  return normalized;
}

export function deleteRequestFilter(id) {
  requestFilters.update((items) => items.filter((item) => item.id !== id));
}

export function resetRequestFilters() {
  requestFilters.set(defaultRequestFilters.map((filter) => ({ ...filter })));
}

export function clearRequestFilterSelections() {
  requestFilterSelections.set([]);
}

// Compass
export const compassCode = writable("");
export const testerInput = writable("");

// Waypoint
export const waypoints = writable({});

// Checkpont
export const checkpointCode = writable("");
export const interceptFlag = writable(false);

// Workshop
export const workshopCode = writable("");

export const logItems = writable([]);
export const extensionElements = writable({});
export const prettify = writable(true);
export const lineWrap = writable(true);

export let drawerHeight = writable("h-[60%]");
export let marasiConfig = writable({});
export async function readConfig() {
  const config = await GetMarasiConfig();
  marasiConfig.set(config);
}

// Launchpad navigation state persistence
export const currentLaunchpadIndex = writable(0);
export const currentLaunchpadRequestIndex = writable(0);
export let listener = writable({
  status: false,
  address: "127.0.0.1",
  port: "8080",
});
export let activeProject = writable("Marasi");
export async function openProject() {
  // Reset inputs
  searchInput.set("");
  filterInput.set("");
  httpqlQuery.set("");
  requestFilterSelections.set([]);
  compassCode.set("");
  testerInput.set("");
  checkpointCode.set("");
  interceptFlag.set(false);
  workshopCode.set("");
  waypoints.set({});
  proxyItems.set({});
  currentLaunchpadIndex.set(0);
  currentLaunchpadRequestIndex.set(0);

  // Reset items
  await populateHistory();
  await populateLogs();
  await populateFilters();
  await populateScope();
  await populateCheckpoint();
  await populateWorkshop();
  await populateWaypoints();
}

export async function populateWaypoints() {
  GetWaypoints()
    .then((points) => {
      console.log(points);
      waypoints.set(points);
    })
    .catch((waypointErr) => {
      console.log(waypointErr);
    });
}
export async function populateWorkshop() {
  GetExtensionCode("workshop")
    .then((code) => {
      workshopCode.set(code);
    })
    .catch((error) => {
      console.log(error);
    });
}
export async function populateCheckpoint() {
  GetExtensionCode("checkpoint")
    .then((code) => {
      checkpointCode.set(code);
    })
    .catch((error) => {
      console.log(error);
    });
  GetInterceptFlag().then((flag) => {
    interceptFlag.set(flag);
  });
}
export async function populateScope() {
  GetExtensionCode("compass")
    .then((code) => {
      compassCode.set(code);
    })
    .catch((error) => {
      console.log(error);
    });
}
export async function populateFilters() {
  GetFilters().then((filters) => {
    console.log("----- Filter ------");
    console.log(filters);
    console.log("----- Filter ------");
    filterItems.set(filters ? filters : []);
  });
}
export async function populateLogs() {
  GetLogs().then((items) => {
    console.log(items);
    logItems.set(items ? items : []);
  });
}
export async function populateHistory() {
  const start = performance.now();
  GetProxyItems().then((items) => {
    console.log("Received items from Go:", items);
    proxyItems.set(items ? items : {});
    const end = performance.now();
    console.log(`Time taken to set store: ${end - start} ms`);
  });
}
