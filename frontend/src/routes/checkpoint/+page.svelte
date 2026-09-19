<script>
	import CodeMirror from "svelte-codemirror-editor";
	import { StreamLanguage } from "@codemirror/language";
	import { http } from "@codemirror/legacy-modes/mode/http";
	import { lua } from "@codemirror/legacy-modes/mode/lua";
	import { oneDark } from "@codemirror/theme-one-dark";
	import { githubLight } from "@uiw/codemirror-theme-github";
	import { vim } from "@replit/codemirror-vim";
	import {
		GetCheckpointItems,
		CheckHTTPParse,
		ForwardCheckpoint,
		DropCheckpoint,
		RunExtension,
		ToggleIntercept,
	} from "../../lib/wailsjs/go/main/App";
	import { onMount } from "svelte";
	import {
		Accordion,
		AccordionItem,
		getDrawerStore,
		getToastStore,
		modeCurrent,
	} from "@skeletonlabs/skeleton";
	import MarasiKeys from "../../lib/components/MarasiMenu/MarasiKeys.svelte";
	import {
		CornerLeftDown,
		EditIcon,
		FileCode,
		FilePenLine,
		Forward,
		SettingsIcon,
		SquarePlay,
		ToggleLeft,
	} from "lucide-svelte";
	import {
		checkpointCode,
		marasiConfig,
		interceptFlag,
		lineWrap,
	} from "../../stores";
	import { autocompletion } from "@codemirror/autocomplete";
	import { marasiCompletionSource } from "../../lib/autocomplete/autocomplete";
	import { EventsOn } from "../../lib/wailsjs/runtime/runtime";
	const toastStore = getToastStore();
	const drawerStore = getDrawerStore();

	let intercepted = "";
	let type = "";
	let currentId = null;
	let error = "";
	let accOpened;
	const checkpointMenu = [
		{
			name: "Toggle Checkpoint Settings",
			subtitle: "Toggle Settings Accordian",
			icon: ToggleLeft,
			keywords: "settings, toggle",
			action: {
				handler: () => {
					accOpened = !accOpened;
				},
				options: { scope: "checkpoint", single: true },
				keys: ["⌘+P", "ctrl+P"],
			},
		},
		{
			name: "Edit Checkpoint",
			subtitle: "Jump to code editor",
			keywords: "edit, toggle",
			icon: EditIcon,
			action: {
				handler: () => {
					if (!accOpened) {
						accOpened = true;
					}
					setTimeout(() => {
						const cmContent =
							document.querySelector(
								'div[data-language="lua"]',
							);
						cmContent.focus();
					}, 300);
				},
				options: { scope: "checkpoint", single: true },
				keys: ["⌘+⇧+E", "ctrl+⇧+E"],
			},
		},
		{
			name: "Update Checkpoint Code",
			subtitle: "Execute Checkpoint code",
			keywords: "edit, toggle",
			icon: SquarePlay,
			action: {
				handler: () => {
					RunExtension(
						"checkpoint",
						$checkpointCode,
					)
						.then(() => {
							const toastSettings = {
								message: "Updated checkpoint rules",
								background: "variant-filled-success",
							};
							toastStore.trigger(
								toastSettings,
							);
						})
						.catch((error) => {
							console.log("Error");
							const toastSettings = {
								message: "Error updating rules",
								background: "variant-filled-error",
							};
							toastStore.trigger(
								toastSettings,
							);
						});
				},
				options: { scope: "checkpoint", single: true },
				keys: ["⌘+⇧+R", "ctrl+⇧+R"],
			},
		},
		{
			name: "Edit Intercepted Item",
			subtitle: "Jump to intercepted item editor",
			keywords: "intercept, toggle",
			icon: FilePenLine,
			action: {
				handler: () => {
					if (interceptedCount > 0) {
						const cmContent =
							document.querySelector(
								'div[data-language="javascript"]',
							);
						cmContent.focus();
					}
				},
				options: { scope: "checkpoint", single: true },
				keys: ["⌘+⇧+I", "ctrl+⇧+I"],
			},
		},
		{
			name: "Forward Intercepted Item",
			subtitle: "Forward current item",
			keywords: "forward, toggle",
			icon: Forward,
			action: {
				handler: () => {
					if (interceptedCount > 0) {
						forward(intercepted);
					}
				},
				options: { scope: "checkpoint", single: true },
				keys: ["⌘+⇧+F", "ctrl+⇧+F"],
			},
		},
		{
			name: "Drop Intercepted Item",
			subtitle: "Drop current item",
			keywords: "drop, toggle",
			icon: CornerLeftDown,
			action: {
				handler: () => {
					if (interceptedCount > 0) {
						drop();
					}
				},
				options: { scope: "checkpoint", single: true },
				keys: ["⌘+⇧+D", "ctrl+⇧+D"],
			},
		},
		{
			name: "Show Logs",
			subtitle: "Show Extension Logs",
			keywords: "logs, lua",
			icon: FileCode,
			action: {
				handler: () => {
					if ($drawerStore.open) {
						drawerStore.close();
					} else {
						const drawerSettings = {
							id: "extension-logs",
							meta: {
								extensionName:
									"checkpoint",
							},
							height: "h-full",
							width: "w-3/5",
							position: "right",
						};
						drawerStore.open(
							drawerSettings,
						);
					}
				},
				options: { scope: "checkpoint", single: true },
				keys: ["⌘+⇧+L", "ctrl+⇧+L"],
			},
		},
	];
	$: {
		CheckSyntax(intercepted);
	}
	let interceptedCount = 0;
	function dumpText(item) {
		const raw = item?.Raw;
		if (!raw) {
			return "";
		}
		if (typeof raw === "string") {
			try {
				const binary = atob(raw);
				return new TextDecoder().decode(
					Uint8Array.from(binary, (char) =>
						char.charCodeAt(0),
					),
				);
			} catch {
				return raw;
			}
		}
		if (raw instanceof Uint8Array) {
			return new TextDecoder().decode(raw);
		}
		if (Array.isArray(raw)) {
			return new TextDecoder().decode(Uint8Array.from(raw));
		}
		return "";
	}
	function CheckSyntax(text) {
		if (!type) {
			error = "";
			return;
		}
		CheckHTTPParse(text, type).then((response) => {
			error = response;
		});
	}
	function forwardAndInterceptResponse() {
		if (!currentId) {
			return;
		}
		ForwardCheckpoint(currentId, intercepted, true).then(() => {
			GetNext();
		});
	}
	function drop() {
		if (!currentId) {
			return;
		}
		DropCheckpoint(currentId).then(() => {
			GetNext();
		});
	}
	function forward(body) {
		if (!currentId) {
			return;
		}
		ForwardCheckpoint(currentId, body, false).then(() => {
			GetNext();
		});
	}
	function GetNext() {
		GetCheckpointItems().then((items) => {
			const httpItems = (items || []).filter((item) => {
				return item.Type === "request" || item.Type === "response";
			});
			interceptedCount = httpItems.length;
			const item = httpItems[0];
			if (item) {
				currentId = item.ID;
				intercepted = dumpText(item);
				type = item.Type;
				return;
			}
			currentId = null;
			intercepted = "No item in queue";
			type = "";
		});
	}
	function getLang(body) {
		switch ($marasiConfig.SyntaxMode) {
			case "disabled":
				return undefined;
			case "auto":
				if (body.length < 75000)
					return StreamLanguage.define(http);
				return undefined;
			case "enabled":
				return StreamLanguage.define(http);
		}
	}
	onMount(() => {
		const unsubscribe = EventsOn("intercepted", () => {
			GetNext();
		});
		GetNext();
		return () => {
			unsubscribe();
		};
	});
</script>

<MarasiKeys scope="checkpoint" menuOptions={checkpointMenu} />
<Accordion rounded="false">
	<AccordionItem bind:open={accOpened}>
		<svelte:fragment slot="lead"><SettingsIcon /></svelte:fragment>
		<svelte:fragment slot="summary"
			>Checkpoint Settings</svelte:fragment
		>
		<svelte:fragment slot="content">
			<CodeMirror
				bind:value={$checkpointCode}
				class="text-xs"
				theme={$modeCurrent ? githubLight : oneDark}
				extensions={$marasiConfig.VimEnabled
					? [
							vim(),
							StreamLanguage.define(
								lua,
							),
							autocompletion({
								override: [
									marasiCompletionSource,
								],
							}),
						]
					: [
							StreamLanguage.define(
								lua,
							),
							autocompletion({
								override: [
									marasiCompletionSource,
								],
							}),
						]}
			/>
			<div class="flex justify-end mt-2">
				<button
					type="button"
					class="btn {$modeCurrent ? 'variant-ghost-primary ring-0 shadow-none' : 'variant-filled-primary'}"
					on:click={() => {
						RunExtension(
							"checkpoint",
							$checkpointCode,
						)
							.then(() => {
								const toastSettings =
									{
										message: "Updated checkpoint rules",
										background: "variant-filled-success",
									};
								toastStore.trigger(
									toastSettings,
								);
							})
							.catch((error) => {
								console.log(
									"Error",
								);
								const toastSettings =
									{
										message: "Error updating rules",
										background: "variant-filled-error",
									};
								toastStore.trigger(
									toastSettings,
								);
							});
					}}>Update Intercept Rules</button
				>
			</div>
		</svelte:fragment>
	</AccordionItem>
</Accordion>
<div class="p-1 flex flex-col items-center">
	<div class={$modeCurrent ? "btn-group checkpoint-ghost-group" : "btn-group variant-filled-primary"}>
		<button
			class={$modeCurrent ? "variant-ghost-primary ring-0 shadow-none" : ""}
			disabled={error !== "" || interceptedCount == 0}
			on:click={() => {
				forward(intercepted);
			}}>Forward</button
		>
		<button
			class={$modeCurrent ? "variant-ghost-primary ring-0 shadow-none" : ""}
			disabled={error !== "" || type !== "request"}
			on:click={() => {
				forwardAndInterceptResponse();
			}}>Intercept Response</button
		>
		<button
			class={$modeCurrent
				? $interceptFlag
					? "btn variant-ghost-success ring-0 shadow-none"
					: "btn variant-ghost-primary ring-0 shadow-none"
				: $interceptFlag
					? "btn variant-filled-success hover:variant-filled-success"
					: "btn variant-filled-primary"}
			on:click={() => {
				ToggleIntercept().then((flag) => {
					interceptFlag.set(flag);
				});
			}}
			>{$interceptFlag
				? "Global Intercept (On)"
				: "Global Intercept (Off)"}</button
		>
		<button
			class={$modeCurrent ? "variant-ghost-primary ring-0 shadow-none" : ""}
			disabled={interceptedCount == 0}
			on:click={() => {
				drop();
			}}>Drop</button
		>
	</div>
	<div class="text-center">
		{#if interceptedCount > 0}
			<p>Intercept Queue: {interceptedCount}</p>
		{:else}
			<p>No items in interception queue</p>
		{/if}
	</div>
	<div class="text-center">
		{#if error === ""}
			<p>No Error</p>
		{:else}
			<p>{error}</p>
		{/if}
	</div>
	<div class="w-full flex justify-center dark:bg-[#282c34]">
		<div class="w-[50%]">
			<CodeMirror
				bind:value={intercepted}
				lang={getLang(intercepted)}
				class="text-xs"
				theme={$modeCurrent ? githubLight : oneDark}
				extensions={$marasiConfig.VimEnabled
					? [vim()]
					: []}
				lineWrapping={$lineWrap}
			/>
		</div>
	</div>
</div>

<style>
	:global(.checkpoint-ghost-group) {
		--tw-ring-shadow: 0 0 #0000;
		box-shadow: none;
	}
	:global(.checkpoint-ghost-group > *) {
		--tw-ring-inset: ;
		--tw-ring-offset-shadow: 0 0 #0000;
		--tw-ring-shadow: 0 0 #0000;
		box-shadow: none !important;
		border: 0 !important;
	}
	:global(.checkpoint-ghost-group > * + *) {
		border-left-width: 0 !important;
	}
	:global(.checkpoint-ghost-group > *:disabled:hover) {
		background-color: rgb(var(--color-primary-500) / 0.2) !important;
		filter: none !important;
		--tw-brightness: brightness(1);
	}
	:global(.checkpoint-ghost-group > .variant-ghost-primary:not(:disabled):hover) {
		background-color: rgb(var(--color-primary-200)) !important;
		filter: none !important;
	}
	:global(.checkpoint-ghost-group > .variant-ghost-success:not(:disabled):hover) {
		background-color: rgb(var(--color-success-200)) !important;
		filter: none !important;
	}
</style>
