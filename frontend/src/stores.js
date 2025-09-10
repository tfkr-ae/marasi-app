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

// Ledger Stores
export const searchInput = writable("");
export const proxyItems = writable({});
export const filterItems = writable([]);
export const filterInput = writable("");

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
