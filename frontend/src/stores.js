import { writable, get } from "svelte/store";
import {
	GetProxyItems,
	GetLogs,
	GetMarasiConfig,
	GetFilters,
	GetExtensionCode,
	GetWaypoints,
	GetInterceptFlag,
	GetExtensions,
	LoadExtensions,
	GetLaunchpads,
	GetLaunchpadRequests,
} from "./lib/wailsjs/go/main/App";


// Startup
export const appState = writable({
	isReady: false,
	message: 'Starting...',
	details: ''
});

// Extensions
export const extensions = writable([]);
export const extensions_ui = writable({});


// Ledger Stores
export const sorting = writable([{ id: "ID", desc: true }]);
export const pagination = writable({ pageIndex: 0, pageSize: 100 });
export const searchInput = writable("");
export const proxyItems = writable([]);
export const contentTypeFilter = writable([]);
export const contentTypeFilterInput = writable("");

let requestBuffer = [];
let responseBuffer = new Map();
function flushBuffer() {
	if (requestBuffer.length === 0 && responseBuffer.size === 0) return;

	const reqBatch = requestBuffer;
	const resBatch = responseBuffer;

	requestBuffer = [];
	responseBuffer = new Map();

	proxyItems.update((items) => {
		let current = Array.isArray(items) ? items : [];

		if (resBatch.size > 0 && current.length > 0) {
			current = current.map(item => {
				if (resBatch.has(item.ID)) {
					return { ...item, ...resBatch.get(item.ID) };
				}
				return item;
			});
		}

		if (reqBatch.length > 0) {
			if (resBatch.size > 0) {
				for (let i = 0; i < reqBatch.length; i++) {
					const req = reqBatch[i];
					if (resBatch.has(req.ID)) {
						reqBatch[i] = { ...req, ...resBatch.get(req.ID) };
					}
				}
			}
			current = [...current, ...reqBatch];
		}

		return current;
	});
}
if (typeof window !== "undefined") {
	setInterval(flushBuffer, 200);
}

export function addRequest(req) {
	requestBuffer.push(req);
	if (requestBuffer.length > 500) flushBuffer();
}
export function addResponse(res) {
	responseBuffer.set(res.ID, res);

	if (responseBuffer.size > 500) flushBuffer();
}

// ---------------------------
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
export const currentEntryIndex = writable(0);
export const activeLaunchpadID = writable("");
export const launchpads = writable([]);

export let listener = writable({
	status: false,
	address: "127.0.0.1",
	port: "8080",
});
export let activeProject = writable("Marasi");
export async function openProject() {
	appState.set({
		isReady: false,
		message: 'Starting...',
		details: ''
	});
	requestBuffer = [];
	responseBuffer = new Map();
	pagination.set({ pageIndex: 0, pageSize: 100 });
	sorting.set([{ id: "ID", desc: true }])
	searchInput.set("");
	contentTypeFilter.set([]);
	contentTypeFilterInput.set("");
	compassCode.set("");
	testerInput.set("");
	checkpointCode.set("");
	interceptFlag.set(false);
	workshopCode.set("");
	waypoints.set({});
	proxyItems.set([]);
	currentEntryIndex.set(0);
	activeLaunchpadID.set("");
	extensions.set([]);
	extensions_ui.set({});
	try {
		await LoadExtensions();
	} catch (err) {
		console.error("Failed to load project extensions:", err);
	}

	// Reset items
	await populateHistory();
	await populateLogs();
	await populateFilters();
	await populateScope();
	await populateCheckpoint();
	await populateWorkshop();
	await populateWaypoints();
	await populateExtensions();
	await populateLaunchpads();
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
		contentTypeFilter.set(filters ? filters : []);
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
		proxyItems.set(items ? items : []);
		const end = performance.now();
		console.log(`Time taken to set store: ${end - start} ms`);
	});
}

export async function populateExtensions() {
	GetExtensions().then((exts) => {
		console.log(exts)
		extensions.set(exts ? exts : []);
	});
}
export async function populateLaunchpads() {
	const items = await GetLaunchpads();

	const initalisedItems = (items || []).map(item => ({
		...item,
		Entries: []
	}));

	launchpads.set(initalisedItems);
}

export async function populateLaunchpadEntries(id) {
	if (!id) return;

	const reqs = await GetLaunchpadRequests(id);
	launchpads.update(tabs => {
		return tabs.map(t => {
			if (t.ID == id) {
				return { ...t, Entries: reqs || [] };
			}
			return t;
		});
	});
}
