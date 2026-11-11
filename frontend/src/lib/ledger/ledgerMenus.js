// The Ledger's ⌘K menus and shortcuts: the drawer-closed and drawer-open actions, the WebSocket stream action, and the drawer's handlers by action id.
import { get } from "svelte/store";
import {
	ToggleLeftIcon,
	SearchIcon,
	FilterIcon,
	ArrowRightIcon,
	ArrowLeftIcon,
	ArrowUpToLineIcon,
	ArrowDownToLineIcon,
	SquareArrowUpRightIcon,
	PenIcon,
	SendIcon,
	CopyIcon,
	GlobeIcon,
	BracesIcon,
	MaximizeIcon,
	WrapTextIcon,
	BookCheckIcon,
	LinkIcon,
	Unlink,
	ShieldAlertIcon,
	Swords,
	RadioIcon,
	PanelLeftIcon,
	MenuIcon,
} from "lucide-svelte";
import { lineWrap } from "../../stores";
import { testCaseStore } from "../../stores/testCaseStore";
import { findingStore } from "../../stores/findingStore";
import { ledgerStore, focusedPair } from "../../stores/ledgerStore";

/**
 * The menus over the page. `table()`, `dock()`, `sitemapFind()` and
 * `toolbar()` return the page's bound components; `isDrawerOpen()` is its
 * drawer state. The rest are the page's actions the entries run.
 */
export function createLedgerMenus({
	modalStore,
	toastStore,
	table,
	dock,
	sitemapFind,
	toolbar,
	isDrawerOpen,
	selectAndReveal,
	runShortcut,
	openRowMenuAtFocus,
	toggleDrawerPane,
	openWebSocketStream,
}) {
	const shortcut = (actionId) => () => runShortcut(actionId);

	// Opens the modal, or closes it when the same one is already open.
	function toggleModal(component, modal) {
		if (!get(modalStore)[0]) modalStore.trigger(modal);
		else if (get(modalStore)[0].component === component) modalStore.close();
	}

	// Focuses `element`, or blurs it when it already has focus.
	function toggleFocus(element) {
		if (!element) return;
		if (document.activeElement === element) element.blur();
		else element.focus();
	}

	const toggleSidebar = {
		icon: PanelLeftIcon,
		handler: () => dock()?.toggle(),
	};
	// ⌘⇧\: the sitemap's find box, expanding the dock; again leaves it.
	const focusSitemap = {
		icon: SearchIcon,
		handler: () => {
			const find = sitemapFind();
			if (find && document.activeElement === find) find.blur();
			else dock()?.expand(true);
		},
	};

	// Search, Filter and Open request, with the drawer open or closed.
	const focusQuery = { icon: SearchIcon, handler: () => toggleFocus(document.getElementById("searchBox")) };
	const focusExclusion = { icon: FilterIcon, handler: () => toolbar()?.focusExclusion() };
	const openRequest = (toggleAction) => ({
		icon: SquareArrowUpRightIcon,
		handler: () => {
			new Promise((resolve) => {
				toggleModal("MenuInput", {
					type: "component",
					component: "MenuInput",
					toggleAction,
					title: "Open request",
					response: resolve,
				});
			}).then((requestIndex) => {
				if (!requestIndex) return;
				const number = parseInt(requestIndex);
				ledgerStore.goToNumber(number).then(({ pair }) => {
					if (pair) return selectAndReveal(pair.ID);
					toastStore.trigger({
						message: `No request ${number} in this project`,
						background: "variant-filled-warning",
						timeout: 2500,
					});
				});
			});
		},
	});

	// ⌘] / ⌘[: back to the results' highest- or lowest-numbered request,
	// with the table scrolled to it.
	function goToNumberEnd(highest) {
		modalStore.close();
		ledgerStore.goToNumberEnd(highest).then(({ pair }) => pair && selectAndReveal(pair.ID));
	}

	const ledgerMenu = [
		{
			actionId: "ledger.drawer-closed.toggle-settings",
			icon: ToggleLeftIcon,
			handler: () => toolbar()?.toggleQueryFields(),
		},
		{ actionId: "ledger.drawer-closed.focus-query", ...focusQuery },
		{ actionId: "ledger.drawer-closed.focus-exclusion", ...focusExclusion },
		{
			actionId: "ledger.drawer-closed.next-page",
			icon: ArrowRightIcon,
			handler: () => table()?.page(1),
		},
		{
			actionId: "ledger.drawer-closed.previous-page",
			icon: ArrowLeftIcon,
			handler: () => table()?.page(-1),
		},
		{ actionId: "ledger.drawer-closed.open-request", ...openRequest("ledger.drawer-closed.open-request") },
		{ actionId: "ledger.drawer-closed.toggle-sidebar", ...toggleSidebar },
		{ actionId: "ledger.drawer-closed.focus-sitemap", ...focusSitemap },
	];

	// Each drawer action works on the focused pair.
	const whenOpen = (fn) => () => {
		if (isDrawerOpen()) fn(focusedPair(get(ledgerStore)).ID);
	};

	const drawerMenu = [
		{ actionId: "ledger.drawer-open.focus-query", ...focusQuery },
		{ actionId: "ledger.drawer-open.focus-exclusion", ...focusExclusion },
		{ actionId: "ledger.drawer-open.open-request", ...openRequest("ledger.drawer-open.open-request") },
		{
			actionId: "ledger.drawer-open.next-request",
			icon: ArrowRightIcon,
			handler: whenOpen(() => {
				modalStore.close();
				ledgerStore.stepNumber(1);
			}),
		},
		{
			actionId: "ledger.drawer-open.first-result",
			icon: ArrowDownToLineIcon,
			handler: whenOpen(() => goToNumberEnd(false)),
		},
		{
			actionId: "ledger.drawer-open.last-result",
			icon: ArrowUpToLineIcon,
			handler: whenOpen(() => goToNumberEnd(true)),
		},
		{
			actionId: "ledger.drawer-open.send-to-armory",
			icon: Swords,
			handler: shortcut("ledger.drawer-open.send-to-armory"),
		},
		{
			actionId: "ledger.drawer-open.previous-request",
			icon: ArrowLeftIcon,
			handler: whenOpen(() => {
				modalStore.close();
				ledgerStore.stepNumber(-1);
			}),
		},
		{
			actionId: "ledger.drawer-open.send-to-launchpad",
			icon: SendIcon,
			handler: shortcut("ledger.drawer-open.send-to-launchpad"),
		},
		{
			actionId: "ledger.drawer-open.create-test-case",
			icon: BookCheckIcon,
			handler: whenOpen(() => {
				if (!get(modalStore)[0]) runShortcut("ledger.drawer-open.create-test-case");
			}),
		},
		{
			actionId: "ledger.drawer-open.link-test-case",
			icon: LinkIcon,
			handler: whenOpen((id) => {
				if (get(modalStore)[0]) {
					if (get(modalStore)[0].component === "SelectTestCase") modalStore.close();
					return;
				}
				if (get(testCaseStore).length === 0) {
					toastStore.trigger({
						message: "No existing test cases found...",
						background: "variant-filled-warning",
					});
					return;
				}
				modalStore.trigger({
					type: "component",
					component: "SelectTestCase",
					toggleAction: "ledger.drawer-open.link-test-case",
					meta: { requestID: id, mode: "link" },
				});
			}),
		},
		{
			actionId: "ledger.drawer-open.unlink-test-case",
			icon: Unlink,
			handler: whenOpen((id) => {
				if (get(modalStore)[0]) {
					if (get(modalStore)[0].component === "SelectTestCase") modalStore.close();
					return;
				}
				if (!get(testCaseStore).some((tc) => tc.Requests?.includes(id))) {
					toastStore.trigger({
						message: "No test cases linked to this request.",
						background: "variant-filled-warning",
					});
					return;
				}
				modalStore.trigger({
					type: "component",
					component: "SelectTestCase",
					toggleAction: "ledger.drawer-open.unlink-test-case",
					meta: { requestID: id, mode: "unlink" },
				});
			}),
		},
		{
			actionId: "ledger.drawer-open.create-finding",
			icon: ShieldAlertIcon,
			handler: whenOpen(() => {
				if (!get(modalStore)[0]) runShortcut("ledger.drawer-open.create-finding");
			}),
		},
		{
			actionId: "ledger.drawer-open.link-finding",
			icon: LinkIcon,
			handler: whenOpen((id) => {
				if (get(modalStore)[0]) {
					if (get(modalStore)[0].component === "SelectFinding") modalStore.close();
					return;
				}
				if (get(findingStore).length === 0) {
					toastStore.trigger({
						message: "No existing findings found...",
						background: "variant-filled-warning",
					});
					return;
				}
				modalStore.trigger({
					type: "component",
					component: "SelectFinding",
					toggleAction: "ledger.drawer-open.link-finding",
					meta: { requestID: id, mode: "link" },
				});
			}),
		},
		{
			actionId: "ledger.drawer-open.unlink-finding",
			icon: Unlink,
			handler: whenOpen((id) => {
				if (get(modalStore)[0]) {
					if (get(modalStore)[0].component === "SelectFinding") modalStore.close();
					return;
				}
				if (!get(findingStore).some((fnd) => fnd.Requests?.includes(id))) {
					toastStore.trigger({
						message: "No findings linked to this request.",
						background: "variant-filled-warning",
					});
					return;
				}
				modalStore.trigger({
					type: "component",
					component: "SelectFinding",
					toggleAction: "ledger.drawer-open.unlink-finding",
					meta: { requestID: id, mode: "unlink" },
				});
			}),
		},
		{
			actionId: "ledger.drawer-open.view-note",
			icon: PenIcon,
			handler: whenOpen(() => toggleDrawerPane("note")),
		},
		{
			actionId: "ledger.drawer-open.view-metadata",
			icon: BracesIcon,
			handler: whenOpen(() => toggleDrawerPane("metadata")),
		},
		{
			actionId: "ledger.drawer-open.copy-url",
			icon: CopyIcon,
			handler: shortcut("ledger.drawer-open.copy-url"),
		},
		{
			actionId: "ledger.drawer-open.copy-raw-request",
			icon: CopyIcon,
			handler: shortcut("ledger.drawer-open.copy-raw-request"),
		},
		{
			actionId: "ledger.drawer-open.copy-raw-response",
			icon: CopyIcon,
			handler: shortcut("ledger.drawer-open.copy-raw-response"),
		},
		{
			actionId: "ledger.drawer-open.copy-browser-view-url",
			icon: GlobeIcon,
			handler: shortcut("ledger.drawer-open.copy-browser-view-url"),
		},
		{
			actionId: "ledger.drawer-open.open-row-menu",
			icon: MenuIcon,
			handler: openRowMenuAtFocus,
		},
		{
			actionId: "ledger.drawer-open.toggle-fullscreen",
			icon: MaximizeIcon,
			handler: () => ledgerStore.toggleDrawerMaximised(),
		},
		{
			actionId: "ledger.drawer-open.toggle-word-wrap",
			icon: WrapTextIcon,
			handler: () => lineWrap.set(!get(lineWrap)),
		},
		{ actionId: "ledger.drawer-open.toggle-sidebar", ...toggleSidebar },
		{ actionId: "ledger.drawer-open.focus-sitemap", ...focusSitemap },
	];
	const websocketDrawerMenuItem = {
		actionId: "ledger.drawer-open.websocket.open-stream",
		icon: RadioIcon,
		handler: openWebSocketStream,
	};

	// The drawer's rail and details column run the same handlers as the
	// shortcuts, by action id. Only drawer-open and WebSocket actions are in
	// it, so a rail button with a drawer-closed id does nothing.
	const drawerHandlers = new Map(
		[websocketDrawerMenuItem, ...drawerMenu].map(({ actionId, handler }) => [actionId, handler]),
	);

	return { ledgerMenu, drawerMenu, websocketDrawerMenuItem, drawerHandlers };
}
