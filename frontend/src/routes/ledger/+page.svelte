<script>
	import { goto } from "$app/navigation";
	import {
		createSvelteTable,
		getCoreRowModel,
		getPaginationRowModel,
		getFilteredRowModel,
		getSortedRowModel,
		flexRender,
		createColumnHelper,
		renderComponent,
	} from "@tanstack/svelte-table";
	import {
		drawerHeight,
		sorting,
		pagination,
		contentTypeFilter,
		contentTypeFilterInput,
		lineWrap,
	} from "../../stores";
	import { derived } from "svelte/store";
	import ContextMenu, { Item, Divider } from "svelte-contextmenu";
	import {
		getDrawerStore,
		getModalStore,
		getToastStore,
		Accordion,
		AccordionItem,
		InputChip,
		ListBoxItem,
		ListBox,
		modeCurrent,
	} from "@skeletonlabs/skeleton";
	import {
		Search,
		ChevronLeft,
		ChevronRight,
		ChevronsLeft,
		ChevronsRight,
		SettingsIcon,
		ToggleLeftIcon,
		SearchIcon,
		FilterIcon,
		ArrowRightIcon,
		ArrowLeftIcon,
		SquareArrowUpRightIcon,
		PenIcon,
		SendIcon,
		CopyIcon,
		BracesIcon,
		MaximizeIcon,
		WrapTextIcon,
		BookCheckIcon,
		LinkIcon,
		Unlink,
		ShieldAlertIcon,
		Swords,
		RadioIcon,
		X,
		LoaderCircle,
		CircleHelp,
		CircleAlert,
		TriangleAlert,
	} from "lucide-svelte";
	import QueryFieldList from "../../lib/components/QueryFieldList.svelte";
	import { appendToQuery } from "../../lib/ledgerQueryFields";
	import MarasiKeys from "../../lib/components/MarasiMenu/MarasiKeys.svelte";
	import { useMenuActions } from "../../lib/keybindings/app.js";
	import { isWebSocketUpgrade } from "../../lib/keybindings/contexts.js";
	import IDCell from "../../lib/components/IDCell.svelte";
	import {
		CreateLaunchpadEntry,
		GetMetadata,
		GetNote,
		GetRawDetails,
		HighlightRow,
		LinkRequestToLaunchpad,
		SetFilters,
	} from "../../lib/wailsjs/go/main/App";
	import { onMount } from "svelte";
	import { testCaseStore } from "../../stores/testCaseStore";
	import { findingStore } from "../../stores/findingStore";
	import { armoryStore } from "../../stores/armoryStore";
	import {
		shownRows,
		findShownPair,
		pairNumber,
		shownPairAtNumber,
		patchShownPairMetadata,
		ledgerPagination,
		setLedgerPagination,
	} from "../../stores/ledgerRows";
	import {
		queryText,
		queryPending,
		ledgerQuery,
		queryActive,
		isQueryActive,
		matchNoun,
		scheduleQuery,
		runQuery,
		rerunQuery,
		clearQuery,
		markQueryError,
		queryPageIndex,
		matchCountLabel,
		queryStatusLabel,
		indexWarning,
		needsOlderPage,
		loadOlderPage,
		markTrafficChanged,
		mergeNewMatches,
	} from "../../stores/ledgerQuery";

	const drawerStore = getDrawerStore();
	const modalStore = getModalStore();
	const toastStore = getToastStore();
	let accOpened = false;
	let drawerOpened = false;
	let contextMenu;
	let selectedPairID;

	function openWebSocketStream() {
		const meta = $drawerStore?.meta;
		if (
			!drawerOpened ||
			!isWebSocketUpgrade(meta) ||
			$modalStore[0]
		)
			return;
		modalStore.trigger({
			type: "component",
			component: "WebsocketStream",
			toggleAction: "ledger.drawer-open.websocket.open-stream",
			meta: {
				upgradeRequest: structuredClone({
					Metadata: meta.metadata,
					Request: meta.request,
					Response:
						meta.incomingResponse ||
						meta.response,
				}),
			},
		});
	}

	async function sendDrawerRequestToArmory() {
		if (!drawerOpened) return;
		try {
			const template = await armoryStore.createTemplateFromRequest(
				$drawerStore.meta.request.ID,
			);
			const toastId = toastStore.trigger({
				message: `Request ${$drawerStore.meta.requestIndex} sent to Armory`,
				background: $modeCurrent
					? "bg-surface-50 text-surface-900 border border-surface-300"
					: "bg-surface-100 text-surface-900",
				action: {
					label: "Jump to Armory",
					response: () => {
						drawerStore.close();
						toastStore.close(toastId);
						goto(`/armory?id=${template.ID}`);
					},
				},
			});
		} catch (error) {
			toastStore.trigger({
				message: `Failed to send request to Armory: ${String(error)}`,
				background: "variant-filled-error",
			});
		}
	}

	let ledgerMenu = [
		{
			actionId: "ledger.drawer-closed.toggle-settings",
			icon: ToggleLeftIcon,
			handler: () => {
				drawerStore.close();
				accOpened = !accOpened;
			},
		},
		{
			actionId: "ledger.drawer-closed.focus-query",
			icon: SearchIcon,
			handler: () => {
				drawerStore.close();
				accOpened = !accOpened;
				setTimeout(() => {
					const searchBox =
						document.getElementById(
							"searchBox",
						);
					if (
						document.activeElement ===
						searchBox
					) {
						searchBox.blur();
					} else {
						searchBox.focus();
					}
				}, 10);
			},
		},
		{
			actionId: "ledger.drawer-closed.focus-exclusion",
			icon: FilterIcon,
			handler: () => {
				drawerStore.close();
				accOpened = !accOpened;
				setTimeout(() => {
					const filterBox =
						document.querySelector(
							'input[placeholder="Filter by Content Type"]',
						);
					if (
						document.activeElement ===
						filterBox
					) {
						filterBox.blur();
					} else {
						filterBox.focus();
					}
				}, 10);
			},
		},
		{
			actionId: "ledger.drawer-closed.next-page",
			icon: ArrowRightIcon,
			handler: () => {
				if (
					!drawerOpened &&
					$table.getCanNextPage()
				) {
					$table.nextPage();
				}
			},
		},
		{
			actionId: "ledger.drawer-closed.previous-page",
			icon: ArrowLeftIcon,
			handler: () => {
				if (
					!drawerOpened &&
					$table.getCanPreviousPage()
				) {
					$table.previousPage();
				}
			},
		},
		{
			actionId: "ledger.drawer-closed.open-request",
			icon: SquareArrowUpRightIcon,
			handler: () => {
				if (!drawerOpened) {
					new Promise((resolve) => {
						const modal = {
							type: "component",
							component: "MenuInput",
							toggleAction: "ledger.drawer-closed.open-request",
							title: "Open request",
							response: (
								r,
							) => {
								resolve(
									r,
								);
							},
						};
						if (!$modalStore[0]) {
							modalStore.trigger(
								modal,
							);
						} else if (
							$modalStore[0]
								.component ===
							"MenuInput"
						) {
							modalStore.close();
						}
					}).then((requestIndex) => {
						if (!requestIndex)
							return;
						const pair =
							shownPairAtNumber(
								parseInt(
									requestIndex,
								),
							);
						if (pair) openDrawer(pair.ID);
					});
				}
			},
		},
	];
	let drawerMenu = [
		{
			actionId: "ledger.drawer-open.next-request",
			icon: ArrowRightIcon,
			handler: () => {
				if (drawerOpened) {
					modalStore.close();
					stepDrawer(1);
				}
			},
		},
		{
			actionId: "ledger.drawer-open.send-to-armory",
			icon: Swords,
			handler: sendDrawerRequestToArmory,
		},
		{
			actionId: "ledger.drawer-open.previous-request",
			icon: ArrowLeftIcon,
			handler: () => {
				if (drawerOpened) {
					modalStore.close();
					stepDrawer(-1);
				}
			},
		},
		{
			actionId: "ledger.drawer-open.send-to-launchpad",
			icon: SendIcon,
			handler: () => {
				if (drawerOpened) {
					const index =
						$drawerStore?.meta
							?.requestIndex;
					CreateLaunchpadEntry(
						"Request " + index,
						"Launchpad for Request " +
							index,
					).then((id) => {
						LinkRequestToLaunchpad(
							$drawerStore
								?.meta
								?.request
								?.ID,
							id,
						).then(() => {
							// Linking edits the pair's metadata.
							markTrafficChanged();
							const toastSettings =
								{
									message:
										"Request " +
										index +
										" sent to Launchpad",
									background:
										$modeCurrent
											? "bg-surface-50 text-surface-900 border border-surface-300"
											: "bg-surface-100 text-surface-900",
									action: {
										label: "Jump to Launchpad",
										response: () => {
											drawerStore.close();
											toastStore.close(
												toastId,
											);
											goto(
												"/launchpad?id=" +
													id,
											);
										},
									},
								};
							const toastId =
								toastStore.trigger(
									toastSettings,
								);
						});
					});
				}
			},
		},
		{
			actionId: "ledger.drawer-open.create-test-case",
			icon: BookCheckIcon,
			handler: () => {
				if (drawerOpened) {
					if (!$modalStore[0]) {
						testCaseStore
							.create([
								$drawerStore
									?.meta
									?.request
									?.ID,
							])
							.then(
								(
									testCase,
								) => {
									const modal =
										{
											type: "component",
											component: "TestCase",
											toggleAction: "ledger.drawer-open.create-test-case",
											meta: {
												testCase: testCase,
												isNew: true,
											},
										};
									modalStore.trigger(
										modal,
									);
								},
							);
					} else if (
						$modalStore[0]
							.component ===
						"TestCase"
					) {
						modalStore.close();
					}
				}
			},
		},
		{
			actionId: "ledger.drawer-open.link-test-case",
			icon: LinkIcon,
			handler: () => {
				if (drawerOpened) {
					if (!$modalStore[0]) {
						if (
							$testCaseStore.length >
							0
						) {
							const modal = {
								type: "component",
								component: "SelectTestCase",
								toggleAction: "ledger.drawer-open.link-test-case",
								meta: {
									requestID: $drawerStore
										?.meta
										?.request
										?.ID,
									mode: "link",
								},
							};
							modalStore.trigger(
								modal,
							);
						} else {
							toastStore.trigger(
								{
									message: "No existing test cases found...",
									background: "variant-filled-warning",
								},
							);
						}
					} else if (
						$modalStore[0]
							.component ===
						"SelectTestCase"
					) {
						modalStore.close();
					}
				}
			},
		},
		{
			actionId: "ledger.drawer-open.unlink-test-case",
			icon: Unlink,
			handler: () => {
				if (drawerOpened) {
					if (!$modalStore[0]) {
						const requestID =
							$drawerStore
								?.meta
								?.request
								?.ID;
						// Check if this specific request is actually linked anywhere
						const hasLinks =
							$testCaseStore.some(
								(tc) =>
									tc.Requests?.includes(
										requestID,
									),
							);

						if (hasLinks) {
							const modal = {
								type: "component",
								component: "SelectTestCase",
								toggleAction: "ledger.drawer-open.unlink-test-case",
								meta: {
									requestID: requestID,
									mode: "unlink",
								},
							};
							modalStore.trigger(
								modal,
							);
						} else {
							toastStore.trigger(
								{
									message: "No test cases linked to this request.",
									background: "variant-filled-warning",
								},
							);
						}
					} else if (
						$modalStore[0]
							.component ===
						"SelectTestCase"
					) {
						modalStore.close();
					}
				}
			},
		},
		{
			actionId: "ledger.drawer-open.create-finding",
			icon: ShieldAlertIcon,
			handler: () => {
				if (drawerOpened) {
					if (!$modalStore[0]) {
						findingStore
							.create([
								$drawerStore
									?.meta
									?.request
									?.ID,
							])
							.then(
								(
									finding,
								) => {
									const modal =
										{
											type: "component",
											component: "Finding",
											toggleAction: "ledger.drawer-open.create-finding",
											meta: {
												finding: finding,
												isNew: true,
											},
										};
									modalStore.trigger(
										modal,
									);
								},
							)
							.catch((err) =>
								console.log(
									err,
								),
							);
					} else if (
						$modalStore[0]
							.component ===
						"Finding"
					) {
						modalStore.close();
					}
				}
			},
		},
		{
			actionId: "ledger.drawer-open.link-finding",
			icon: LinkIcon,
			handler: () => {
				if (drawerOpened) {
					if (!$modalStore[0]) {
						if (
							$findingStore.length >
							0
						) {
							const modal = {
								type: "component",
								component: "SelectFinding",
								toggleAction: "ledger.drawer-open.link-finding",
								meta: {
									requestID: $drawerStore
										?.meta
										?.request
										?.ID,
									mode: "link",
								},
							};
							modalStore.trigger(
								modal,
							);
						} else {
							toastStore.trigger(
								{
									message: "No existing findings found...",
									background: "variant-filled-warning",
								},
							);
						}
					} else if (
						$modalStore[0]
							.component ===
						"SelectFinding"
					) {
						modalStore.close();
					}
				}
			},
		},
		{
			actionId: "ledger.drawer-open.unlink-finding",
			icon: Unlink,
			handler: () => {
				if (drawerOpened) {
					if (!$modalStore[0]) {
						const requestID =
							$drawerStore
								?.meta
								?.request
								?.ID;
						// Check if this specific request is actually linked anywhere
						const hasLinks =
							$findingStore.some(
								(fnd) =>
									fnd.Requests?.includes(
										requestID,
									),
							);

						if (hasLinks) {
							const modal = {
								type: "component",
								component: "SelectFinding",
								toggleAction: "ledger.drawer-open.unlink-finding",
								meta: {
									requestID: requestID,
									mode: "unlink",
								},
							};
							modalStore.trigger(
								modal,
							);
						} else {
							toastStore.trigger(
								{
									message: "No findings linked to this request.",
									background: "variant-filled-warning",
								},
							);
						}
					} else if (
						$modalStore[0]
							.component ===
						"SelectFinding"
					) {
						modalStore.close();
					}
				}
			},
		},
		{
			actionId: "ledger.drawer-open.view-note",
			icon: PenIcon,
			handler: () => {
				if (drawerOpened) {
					GetNote(
						$drawerStore?.meta
							?.request?.ID,
					).then((note) => {
						const modal = {
							type: "component",
							component: "Notes",
							toggleAction: "ledger.drawer-open.view-note",
							title:
								"Request " +
								$drawerStore
									?.meta
									?.requestIndex +
								" notes",
							requestID: $drawerStore
								?.meta
								?.request
								?.ID,
							content: note,
						};
						if (!$modalStore[0]) {
							modalStore.trigger(
								modal,
							);
						} else if (
							$modalStore[0]
								.component ===
							"Notes"
						) {
							modalStore.close();
						}
					});
				}
			},
		},
		{
			actionId: "ledger.drawer-open.view-metadata",
			icon: BracesIcon,
			handler: () => {
				if (drawerOpened) {
					GetMetadata(
						$drawerStore?.meta
							?.request?.ID,
					).then((metadata) => {
						const modal = {
							type: "component",
							component: "Metadata",
							toggleAction: "ledger.drawer-open.view-metadata",
							content: metadata,
							title:
								"Request " +
								$drawerStore
									?.meta
									?.requestIndex +
								" Metadata",
						};
						if (!$modalStore[0]) {
							modalStore.trigger(
								modal,
							);
						} else if (
							$modalStore[0]
								.component ===
							"Metadata"
						) {
							modalStore.close();
						}
					});
				}
			},
		},
		{
			actionId: "ledger.drawer-open.copy-url",
			icon: CopyIcon,
			handler: () => {
				if (drawerOpened) {
					const url =
						$drawerStore?.meta
							?.request
							?.Scheme +
						"://" +
						$drawerStore?.meta
							?.request
							?.Host +
						$drawerStore?.meta
							?.request?.Path;
					navigator.clipboard
						.writeText(url)
						.then(() => {
							const toastSettings =
								{
									message: "URL copied to clipboard",
									background: "variant-filled-success",
								};
							toastStore.trigger(
								toastSettings,
							);
						})
						.catch((err) => {
							const toastSettings =
								{
									message: "Failed to copy URL",
									background: "variant-filled-error",
								};
							toastStore.trigger(
								toastSettings,
							);
						});
				}
			},
		},
		{
			actionId: "ledger.drawer-open.copy-raw-request",
			icon: CopyIcon,
			handler: () => {
				if (drawerOpened) {
					navigator.clipboard
						.writeText(
							$drawerStore
								?.meta
								?.request
								?.Raw,
						)
						.then(() => {
							const toastSettings =
								{
									message: "Request copied to clipboard",
									background: "variant-filled-success",
								};
							toastStore.trigger(
								toastSettings,
							);
						})
						.catch((err) => {
							const toastSettings =
								{
									message: "Failed to copy request",
									background: "variant-filled-error",
								};
							toastStore.trigger(
								toastSettings,
							);
						});
				}
			},
		},
		{
			actionId: "ledger.drawer-open.copy-raw-response",
			icon: CopyIcon,
			handler: () => {
				if (drawerOpened) {
					navigator.clipboard
						.writeText(
							$drawerStore
								?.meta
								?.response
								?.Raw,
						)
						.then(() => {
							const toastSettings =
								{
									message: "Response copied to clipboard",
									background: "variant-filled-success",
								};
							toastStore.trigger(
								toastSettings,
							);
						})
						.catch((err) => {
							const toastSettings =
								{
									message: "Failed to copy response",
									background: "variant-filled-error",
								};
							toastStore.trigger(
								toastSettings,
							);
						});
				}
			},
		},
		{
			actionId: "ledger.drawer-open.toggle-fullscreen",
			icon: MaximizeIcon,
			handler: () => {
				if (drawerOpened) {
					if (
						$drawerHeight ===
						"h-[60%]"
					) {
						$drawerHeight =
							"h-[100%]";
						$drawerStore.height =
							$drawerHeight;
					} else {
						$drawerHeight =
							"h-[60%]";
						$drawerStore.height =
							$drawerHeight;
					}
				}
			},
		},
		{
			actionId: "ledger.drawer-open.toggle-word-wrap",
			icon: WrapTextIcon,
			handler: () => {
				$lineWrap = $lineWrap ? false : true;
			},
		},
	];
	const websocketDrawerMenuItem = {
		actionId: "ledger.drawer-open.websocket.open-stream",
		icon: RadioIcon,
		handler: openWebSocketStream,
	};

	const columnHelper = createColumnHelper();
	const columns = [
		columnHelper.accessor("ID", {
			header: "ID",
			cell: (info) =>
				renderComponent(IDCell, {
					index: pairNumber(info.row.original.ID),
					row: info.row.original,
				}),
			sortingFn: "text",
			meta: {
				classes: "centered-cell",
			},
		}),
		columnHelper.accessor("Host", {
			header: "Host",
			meta: {
				classes: "host-cell",
			},
		}),
		columnHelper.accessor("Method", {
			header: "Method",
			meta: {
				classes: "centered-cell",
			},
		}),
		columnHelper.accessor("Path", {
			header: "Path",
			meta: {
				classes: "path-cell",
			},
		}),
		columnHelper.accessor("ContentType", {
			header: "Content Type",
			meta: {
				classes: "centered-cell",
			},
			filterFn: (row, id, filterValue) => {
				if (!filterValue || filterValue.length === 0)
					return true;
				const rowValue = row.getValue(id);
				return !filterValue.includes(rowValue);
			},
		}),
		columnHelper.accessor("Length", {
			header: "Content Length",
			meta: {
				classes: "centered-cell",
			},
		}),
		columnHelper.accessor("Status", {
			header: "Status",
			meta: {
				classes: "centered-cell",
			},
		}),
	];

	const setSorting = (updater) => {
		sorting.update((old) =>
			updater instanceof Function ? updater(old) : updater,
		);
	};

	// Reaching the last loaded page of query results loads the next older
	// page. This runs again after each load, so pages that come back short
	// or empty while a cursor remains keep loading.
	$: if (
		needsOlderPage(
			$ledgerQuery,
			$queryPageIndex,
			$pagination.pageSize,
		)
	) {
		loadOlderPage();
	}

	$: queryErrorMark = markQueryError($ledgerQuery.error);

	// After a query change or a change in the loaded results (a merge of new
	// matches or an older page), the selected row and the open drawer stay
	// when their pair is still in the rows, and close otherwise.
	let lastShownRowsSignature = shownRowsSignature($ledgerQuery);
	$: if (shownRowsSignature($ledgerQuery) !== lastShownRowsSignature) {
		lastShownRowsSignature = shownRowsSignature($ledgerQuery);
		keepFocusOnShownPair();
	}

	// Changes whenever the shown rows can lose pairs: on a switch between
	// modes, a new query run, or a change in the loaded query results.
	function shownRowsSignature(q) {
		return `${isQueryActive(q)}:${q.runID}:${q.items.length}`;
	}

	function keepFocusOnShownPair() {
		if (selectedPairID != null && !findShownPair(selectedPairID)) {
			selectedPairID = undefined;
		}
		if (!drawerOpened || $drawerStore.id !== "request-response") return;
		const pair = findShownPair($drawerStore.meta?.request?.ID);
		if (!pair) {
			drawerStore.close();
			return;
		}
		// A pair new to the live view gets its number, and a switch between
		// modes changes whether the exclusion can hide it.
		const requestIndex = pairNumber(pair.ID);
		const isFiltered = hiddenByExclusion(pair);
		if (
			$drawerStore.meta.requestIndex !== requestIndex ||
			$drawerStore.meta.isFiltered !== isFiltered
		) {
			drawerStore.update((s) => {
				s.meta.requestIndex = requestIndex;
				s.meta.isFiltered = isFiltered;
				return s;
			});
		}
	}

	// The app's primary button convention, for the Query badge and the active
	// field-list toggle. $modeCurrent is true in light mode.
	$: primaryClass = $modeCurrent
		? "variant-ghost-primary ring-0 shadow-none"
		: "variant-filled-primary";

	let queryFieldsOpen = false;

	// Appends a field-list example to the query box and runs it like typing.
	function insertQueryExample(example) {
		const text = appendToQuery($queryText, example);
		queryText.set(text);
		scheduleQuery(text);
		document.getElementById("searchBox")?.focus();
	}

	function onQueryKeydown(e) {
		if (e.key === "Enter") {
			e.preventDefault();
			runQuery($queryText);
		} else if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			clearQuery();
		}
	}

	// Stores the content-type exclusion, then runs the active query again so
	// its results reflect it. The QueryTraffic binding reads the stored
	// exclusion itself.
	async function saveContentTypeExclusion() {
		setLedgerPagination((old) => ({
			...old,
			pageIndex: 0,
		}));
		await SetFilters($contentTypeFilter);
		await rerunQuery();
	}

	const options = derived(
		[
			shownRows,
			sorting,
			ledgerPagination,
			contentTypeFilter,
			queryActive,
		],
		([
			$data,
			$sorting,
			$pagination,
			$contentTypeFilter,
			$queryActive,
		]) => {
			const currentFilters = [];

			// Query results come back with the content-type exclusion
			// already applied, so the table applies it in the live view
			// only.
			if (!$queryActive && $contentTypeFilter?.length) {
				currentFilters.push({
					id: "ContentType",
					value: $contentTypeFilter,
				});
			}
			// Query results stay newest first: sorting only the loaded
			// part of the results would mislead.
			return {
				data: $data,
				columns,
				autoResetPageIndex: false,
				enableSorting: !$queryActive,
				state: {
					sorting: $queryActive ? [] : $sorting,
					pagination: $pagination,
					columnFilters: currentFilters,
				},
				onSortingChange: setSorting,
				onPaginationChange: setLedgerPagination,
				getCoreRowModel: getCoreRowModel(),
				getSortedRowModel: getSortedRowModel(),
				getPaginationRowModel: getPaginationRowModel(),
				getFilteredRowModel: getFilteredRowModel(),
			};
		},
	);

	const table = createSvelteTable(options);

	// Position of the pair among the rows on the current table page, or -1.
	function pagePosition(id) {
		return $table
			.getRowModel()
			.rows.findIndex((row) => row.original.ID === id);
	}

	// True when the content-type exclusion hides the pair in the live view,
	// as the ContentType column's filter does. Query results never contain
	// hidden pairs, so this is false in query mode.
	function hiddenByExclusion(pair) {
		return (
			!$queryActive &&
			($contentTypeFilter ?? []).includes(pair.ContentType)
		);
	}

	// Opens the drawer on the shown pair with this ID.
	function openDrawer(id) {
		const pair = findShownPair(id);
		if (!pair) return;
		const requestIndex = pairNumber(id);
		GetRawDetails(pair.ID).then((requestResponse) => {
			const drawerSettings = {
				id: "request-response",
				meta: {
					metadata: requestResponse.Metadata,
					request: requestResponse.Request,
					response: requestResponse.Response,
					requestIndex,
					// Shows the drawer's "Filtered" label.
					isFiltered: hiddenByExclusion(pair),
				},
				height: $drawerHeight,
				width: "w-full",
				position: "bottom",
			};
			drawerStore.open(drawerSettings);
		});
	}

	// Opens the drawer on the row `step` places from the drawer's pair on the
	// current table page. When that pair isn't on the page, a forward step
	// opens the first row and a backward step opens the last.
	function stepDrawer(step) {
		const rows = $table.getRowModel().rows;
		if (rows.length === 0) return;
		const position = pagePosition($drawerStore?.meta?.request?.ID);
		let target;
		if (position === -1) {
			target = step > 0 ? 0 : rows.length - 1;
		} else {
			target = position + step;
		}
		if (target < 0 || target >= rows.length) return;
		openDrawer(rows[target].original.ID);
	}
	// Every Ledger action stays registered; the drawer-closed, drawer-open and
	// WebSocket-upgrade menu contexts decide which ones a key reaches.
	useMenuActions([...ledgerMenu, websocketDrawerMenuItem, ...drawerMenu]);
	// The menu lists the actions of the drawer's current state.
	$: menuOptions = !$drawerStore.open
		? ledgerMenu
		: isWebSocketUpgrade($drawerStore.meta)
			? [websocketDrawerMenuItem, ...drawerMenu]
			: drawerMenu;

	onMount(() => {
		const unsubscribe = drawerStore.subscribe((settings) => {
			drawerOpened = settings.open ? settings.open : false;
		});
		return () => {
			drawerOpened = false;
			unsubscribe();
		};
	});
</script>

<MarasiKeys {menuOptions} />
<Accordion rounded="none">
	<AccordionItem bind:open={accOpened}>
		<svelte:fragment slot="lead"><SettingsIcon /></svelte:fragment>
		<svelte:fragment slot="summary">
			<div class="flex min-w-0 items-center gap-2">
				<span class="whitespace-nowrap">Ledger Settings</span>
				{#if $queryActive}
					<span
						id="ledgerQueryBadge"
						class="badge {primaryClass}">Query</span
					>
					<span
						class="min-w-0 truncate font-mono text-xs opacity-80"
						title={$ledgerQuery.ranQuery}
						>{$ledgerQuery.ranQuery}</span
					>
					<span
						id="ledgerQueryMatchCount"
						class="whitespace-nowrap text-xs opacity-70"
						>{$matchCountLabel}</span
					>
					{#if !$ledgerQuery.indexComplete}
						<span
							class="text-warning-500"
							title="Indexing older traffic — text matches may be incomplete"
							><TriangleAlert size={14} /></span
						>
					{/if}
				{/if}
				{#if $ledgerQuery.error?.query === $queryText && !accOpened}
					<span
						id="ledgerQueryErrorMarker"
						class="text-error-500"
						title="Invalid query: {$ledgerQuery.error.message}"
						><CircleAlert size={14} /></span
					>
				{/if}
			</div>
		</svelte:fragment>
		<svelte:fragment slot="content">
			<div class="flex flex-col gap-4 p-2">
				<div class="flex flex-col gap-1">
					<div
						class="input-group input-group-divider {$queryText
							? 'grid-cols-[auto_minmax(0,1fr)_auto_auto]'
							: 'grid-cols-[auto_minmax(0,1fr)_auto]'}"
					>
						<div class="input-group-shim">
							{#if $queryPending}
								<LoaderCircle
									size={24}
									class="animate-spin"
								/>
							{:else}
								<Search size={24} />
							{/if}
						</div>
						<input
							id="searchBox"
							class="min-w-0 font-mono"
							type="text"
							autocomplete="off"
							spellcheck="false"
							placeholder="Search traffic…"
							bind:value={$queryText}
							on:input={() =>
								scheduleQuery($queryText)}
							on:keydown={onQueryKeydown}
						/>
						{#if $queryText}
							<button
								id="ledgerQueryClear"
								type="button"
								class="input-group-shim"
								title="Clear query (Esc)"
								aria-label="Clear query"
								on:click={() => clearQuery()}
							>
								<X size={16} />
							</button>
						{/if}
						<button
							id="ledgerQueryFieldsToggle"
							type="button"
							class="input-group-shim {queryFieldsOpen
								? primaryClass
								: ''}"
							title="Query fields"
							aria-label="Query fields"
							aria-expanded={queryFieldsOpen}
							aria-controls="ledgerQueryFields"
							on:click={() =>
								(queryFieldsOpen = !queryFieldsOpen)}
						>
							<CircleHelp size={16} />
						</button>
					</div>
					{#if $ledgerQuery.error}
						<div
							class="text-error-500 text-xs"
							role="alert"
						>
							{#if queryErrorMark}
								<pre
									class="font-mono whitespace-pre-wrap break-all">{queryErrorMark.before}<mark
										class="bg-error-500 text-white"
										>{queryErrorMark.at}</mark
									>{queryErrorMark.after}</pre>
								<span
									>Position {$ledgerQuery
										.error
										.position}: {$ledgerQuery
										.error
										.message}</span
								>
							{:else}
								<span
									>{$ledgerQuery.error
										.message}</span
								>
							{/if}
						</div>
					{/if}
					{#if $queryStatusLabel}
						<div class="text-xs opacity-70">
							{$queryStatusLabel}
						</div>
					{/if}
					{#if $indexWarning}
						<div
							class="text-warning-500 text-xs"
							role="status"
						>
							{$indexWarning}
						</div>
					{/if}
				</div>
				{#if queryFieldsOpen}
					<div
						id="ledgerQueryFields"
						class="card max-h-[50vh] overflow-auto p-3"
					>
						<QueryFieldList
							on:insert={(e) =>
								insertQueryExample(e.detail)}
						/>
					</div>
				{/if}
				<InputChip
					bind:input={$contentTypeFilterInput}
					bind:value={$contentTypeFilter}
					name="chips"
					placeholder="Filter by Content Type"
					rounded="none"
					on:add={saveContentTypeExclusion}
					on:remove={saveContentTypeExclusion}
				></InputChip>

				<div
					class="flex flex-wrap items-center justify-between gap-2 text-sm"
				>
					<div class="flex items-center gap-2">
						<span class="opacity-70"
							>Rows per page:</span
						>
						<select
							class="select select-sm w-20"
							value={$pagination.pageSize}
							on:change={(e) => {
								const val = e
									.target
									.value
									? Number(
											e
												.target
												.value,
										)
									: 10;
								setLedgerPagination(
									(
										old,
									) => ({
										...old,
										pageSize: val,
									}),
								);
							}}
						>
							{#each [10, 20, 30, 40, 50, 100] as pageSize}
								<option
									value={pageSize}
									>{pageSize}</option
								>
							{/each}
						</select>
					</div>

					<div class="flex items-center gap-2">
						<span class="opacity-70">
							Page {$table.getState()
								.pagination
								.pageIndex + 1} of
							{$table
								.getPageCount()
								.toLocaleString()}
						</span>

						<div
							class="btn-group btn-group-sm {$modeCurrent ? 'bg-surface-200 text-surface-900' : 'variant-filled-surface'}"
						>
							<button
								disabled={!$table.getCanPreviousPage()}
								on:click={() =>
									$table.setPageIndex(
										0,
									)}
								title="First Page"
							>
								<ChevronsLeft
									size={16}
								/>
							</button>
							<button
								disabled={!$table.getCanPreviousPage()}
								on:click={() =>
									$table.previousPage()}
								title="Previous Page"
							>
								<ChevronLeft
									size={16}
								/>
							</button>
							<button
								disabled={!$table.getCanNextPage()}
								on:click={() =>
									$table.nextPage()}
								title="Next Page"
							>
								<ChevronRight
									size={16}
								/>
							</button>
							<button
								disabled={!$table.getCanNextPage()}
								on:click={() =>
									$table.setPageIndex(
										$table.getPageCount() -
											1,
									)}
								title="Last Page"
							>
								<ChevronsRight
									size={16}
								/>
							</button>
						</div>
					</div>
				</div>
			</div>
		</svelte:fragment>
	</AccordionItem>
</Accordion>

<div class="no-select font-mono text-xs">
	{#if $queryActive && $ledgerQuery.newMatches.length > 0}
		<!-- Fixed strip across the content area (right of the 80px app rail),
		     so the button floats centred at the bottom of the window without
		     moving the rows. The strip ignores clicks; only the button takes them. -->
		<div
			class="pointer-events-none fixed bottom-6 left-20 right-0 z-10 flex justify-center"
		>
			<div class="bg-surface-50-900-token pointer-events-auto">
				<button
					type="button"
					class="btn btn-sm {primaryClass}"
					on:click={mergeNewMatches}
				>
					{$ledgerQuery.newMatches.length.toLocaleString()}
					new {matchNoun($ledgerQuery.newMatches.length)}
				</button>
			</div>
		</div>
	{/if}
	<table class="table">
		<thead>
			{#each $table.getHeaderGroups() as hg}
				<tr>
					{#each hg.headers as header}
						<th colSpan={header.colSpan}>
							{#if !header.isPlaceholder}
								<div
									class:cursor-pointer={header.column.getCanSort()}
									class:select-none={header.column.getCanSort()}
									on:click={header.column.getToggleSortingHandler()}
									on:keydown
									role="button"
									tabindex="0"
								>
									<svelte:component
										this={flexRender(
											header
												.column
												.columnDef
												.header,
											header.getContext(),
										)}
									/>
									{#if header.column.getIsSorted() === "asc"}
										&uarr;
									{:else if header.column.getIsSorted() === "desc"}
										&darr;
									{/if}
								</div>
							{/if}
						</th>
					{/each}
				</tr>
			{/each}
		</thead>
		<tbody>
			{#each $table.getRowModel().rows as row}
				<tr
					style="background-color: {row.original
						.Metadata?.highlight ?? ''}"
					on:click={() => {
						openDrawer(row.original.ID);
					}}
					on:contextmenu={(e) => {
						selectedPairID = row.original.ID;
						contextMenu.show(e);
					}}
				>
					{#each row.getVisibleCells() as cell}
						<td
							class={cell.column
								.columnDef.meta
								?.classes ?? ""}
						>
							<svelte:component
								this={flexRender(
									cell
										.column
										.columnDef
										.cell,
									cell.getContext(),
								)}
							/>
						</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<ContextMenu bind:this={contextMenu}>
	<Item
		on:click={() => {
			GetNote(selectedPairID).then((note) => {
				const modal = {
					type: "component",
					component: "Notes",
					toggleAction: "ledger.drawer-open.view-note",
					title:
						"Request " +
						pairNumber(selectedPairID) +
						" notes",
					requestID: selectedPairID,
					content: note,
				};
				if (!$modalStore[0]) {
					modalStore.trigger(modal);
				}
			});
		}}
	>
		Open Note
	</Item>
	<Item
		on:click={() => {
			const index = pairNumber(selectedPairID);
			CreateLaunchpadEntry(
				"Request " + index,
				"Launchpad for Request " + index,
			).then((id) => {
				LinkRequestToLaunchpad(
					selectedPairID,
					id,
				).then(() => {
					// Linking edits the pair's metadata.
					markTrafficChanged();
					const toastSettings = {
						message:
							"Request " +
							index +
							" sent to Launchpad",
						background: $modeCurrent
							? "bg-surface-50 text-surface-900 border border-surface-300"
							: "bg-surface-100 text-surface-900",
						action: {
							label: "Jump to Launchpad",
							response: () => {
								drawerStore.close();
								toastStore.close(
									toastId,
								);
								goto(
									"/launchpad?lastTab=1",
								);
							},
						},
					};
					const toastId =
						toastStore.trigger(
							toastSettings,
						);
				});
			});
		}}>Send to Launchpad</Item
	>
	<Item
		on:click={() => {
			testCaseStore
				.create([selectedPairID])
				.then((testCase) => {
					const modal = {
						type: "component",
						component: "TestCase",
						toggleAction: "ledger.drawer-open.create-test-case",
						meta: {
							testCase: testCase,
							isNew: true,
						},
					};
					modalStore.trigger(modal);
				});
		}}>Create Test Case</Item
	>
	<Item
		on:click={() => {
			findingStore
				.create([selectedPairID])
				.then((finding) => {
					const modal = {
						type: "component",
						component: "Finding",
						toggleAction: "ledger.drawer-open.create-finding",
						meta: {
							finding: finding,
							isNew: true,
						},
					};
					modalStore.trigger(modal);
				});
		}}>Create Finding</Item
	>
	<Divider />
	<ListBox active="">
		<ListBoxItem
			group
			name
			value
			on:click={() => {
				const color = 15680580;
				HighlightRow(
					selectedPairID,
					color,
				).then(() => {
					patchShownPairMetadata(selectedPairID, {
						highlight:
							"#" +
							color
								.toString(16)
								.padStart(6, "0"),
					});
				});
			}}
			class="!bg-red-500 text-black hover:brightness-110">Red</ListBoxItem
		>
		<ListBoxItem
			group
			name
			value
			on:click={() => {
				const color = 2278750;
				HighlightRow(
					selectedPairID,
					color,
				).then(() => {
					patchShownPairMetadata(selectedPairID, {
						highlight:
							"#" +
							color
								.toString(16)
								.padStart(6, "0"),
					});
				});
			}}
			class="!bg-green-500 text-black hover:brightness-110">Green</ListBoxItem
		>
		<ListBoxItem
			group
			name
			value
			on:click={() => {
				const color = 15381256;
				HighlightRow(
					selectedPairID,
					color,
				).then(() => {
					patchShownPairMetadata(selectedPairID, {
						highlight:
							"#" +
							color
								.toString(16)
								.padStart(6, "0"),
					});
				});
			}}
			class="!bg-yellow-500 text-black hover:brightness-110">Yellow</ListBoxItem
		>
		<ListBoxItem
			group
			name
			value
			on:click={() => {
				const color = 3900150;
				HighlightRow(
					selectedPairID,
					color,
				).then(() => {
					patchShownPairMetadata(selectedPairID, {
						highlight:
							"#" +
							color
								.toString(16)
								.padStart(6, "0"),
					});
				});
			}}
			class="!bg-blue-500 text-black hover:brightness-110">Blue</ListBoxItem
		>
		<ListBoxItem
			group
			name
			value
			on:click={() => {
				const color = 11032055;
				HighlightRow(
					selectedPairID,
					color,
				).then(() => {
					patchShownPairMetadata(selectedPairID, {
						highlight:
							"#" +
							color
								.toString(16)
								.padStart(6, "0"),
					});
				});
			}}
			class="!bg-purple-500 text-black hover:brightness-110">Purple</ListBoxItem
		>
		<ListBoxItem
			group
			name
			value
			on:click={() => {
				HighlightRow(selectedPairID, -1).then(
					() => {
						patchShownPairMetadata(selectedPairID, {
							highlight: "",
						});
					},
				);
			}}
			class="context-menu-none">None</ListBoxItem
		>
	</ListBox>
</ContextMenu>

<style>
	thead th {
		text-align: center;
		line-height: normal;
		white-space: nowrap;
		border-bottom: 1px solid rgb(var(--color-primary-500));
		background-color: rgb(var(--color-surface-50));
	}
	.table {
		border-collapse: collapse;
		width: 100%;
		font-size: 1rem;
	}
	tbody tr,
	tbody tr:nth-child(even),
	tbody tr:nth-child(odd) {
		background-color: rgb(var(--color-surface-50));
	}
	tbody tr:hover,
	tbody tr:nth-child(even):hover,
	tbody tr:nth-child(odd):hover {
		background-color: rgb(var(--color-surface-200)) !important;
	}
	:global(.dark) thead th,
	:global(.dark) tbody tr,
	:global(.dark) tbody tr:nth-child(even),
	:global(.dark) tbody tr:nth-child(odd) {
		background-color: rgb(var(--color-surface-900));
	}
	:global(.dark) tbody tr:hover,
	:global(.dark) tbody tr:nth-child(even):hover,
	:global(.dark) tbody tr:nth-child(odd):hover {
		background-color: rgb(var(--color-surface-700)) !important;
	}
	tbody td {
		vertical-align: middle;
		padding: 0.25rem;
		line-height: 1rem;
		border-bottom: 1px solid rgb(var(--color-surface-500));
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.centered-cell {
		width: 1em;
		text-align: center;
		padding: 0.5em;
	}

	.host-cell {
		text-align: left;
		max-width: 10em;
		width: 10em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.path-cell {
		width: auto;
		max-width: 15em;
	}
</style>
