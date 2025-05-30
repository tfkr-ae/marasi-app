<script context="module">
	import { slide } from "svelte/transition";

	// TODO LATER
	import {
		prefersReducedMotionStore,
		dynamicTransition,
	} from "./utilities";

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	// type SlideTransition = typeof slide;
	// type TransitionIn = Transition;
	// type TransitionOut = Transition;
</script>

<script>
	import { createEventDispatcher } from "svelte";
	import { flip } from "svelte/animate";
	import {marasiConfig } from "../../../stores.js";

	// Types
	const dispatch = createEventDispatcher();

	// Props
	export let input = undefined;
	export let options = [];
	export let limit = undefined;
	export let allowlist = [];
	export let denylist = [];
	export let emptyState = "No Results Found.";
	export let regionNav = "";
	export let regionList = "list-nav";
	export let regionItem = "";
	export let regionButton = "w-full";
	export let regionEmpty = "text-center";
	export let filter = filterOptions;

	// TODO
	export let transitions = !$prefersReducedMotionStore;
	export let transitionIn = slide;

	export let transitionInParams = { duration: 200 };

	// TODO
	export let transitionOut = slide;
	export let transitionOutParams = { duration: 200 };

	// Local
	$: listedOptions = options;

	function filterByAllowDeny(allowlist, denylist) {
		let _options = [...options];
		// Allowed Options
		if (allowlist.length) {
			_options = _options.filter((option) =>
				allowlist.includes(option.value),
			);
		}

		// Denied Options
		if (denylist.length) {
			_options = _options.filter(
				(option) => !denylist.includes(option.value),
			);
		}

		// Reset options
		if (!allowlist.length && !denylist.length) {
			_options = options;
		}

		listedOptions = _options;
	}

	function filterOptions() {
		// Create a local copy of options
		let _options = [...listedOptions];
		// Filter options
		_options = _options.filter((option) => {
			// Format the input search value
			const inputFormatted = String(input)
				.toLowerCase()
				.trim();
			// Format the option
			let optionFormatted = JSON.stringify([
				option.label,
				option.value,
				option.keywords,
			]).toLowerCase();
			// Check Match
			if (optionFormatted.includes(inputFormatted))
				return option;
		});
		return _options;
	}

	function onSelection(option) {
		/** @event {Option} selection - Fire on option select. */
		dispatch("selection", option);
	}

	// State
	$: filterByAllowDeny(allowlist, denylist);
	$: optionsFiltered = input ? filter() : listedOptions;
	$: sliceLimit = limit ?? optionsFiltered.length;
	// Reactive
	$: classesBase = `${$$props.class ?? ""}`;
	$: classesNav = `${regionNav}`;
	$: classesList = `${regionList}`;
	$: classesItem = `${regionItem}`;
	$: classesButton = `${regionButton}`;
	$: classesEmpty = `${regionEmpty}`;
</script>

<!-- animate:flip={{ duration }} -->
<div class="autocomplete {classesBase}" data-testid="autocomplete">
	{#if optionsFiltered.length > 0}
		<nav class="autocomplete-nav {classesNav}">
			<ul class="autocomplete-list {classesList}">
				{#each optionsFiltered.slice(0, sliceLimit) as option (option)}
					<li
						class="autocomplete-item {classesItem}"
						in:dynamicTransition|local={{
							transition: transitionIn,
							params: transitionInParams,
							enabled: transitions,
						}}
						out:dynamicTransition|local={{
							transition: transitionOut,
							params: transitionOutParams,
							enabled: transitions,
						}}
					>
						<button
							tabindex="0"
							class="flex items-center justify-between w-full
				border-l-4 border-primary-500 px-3 py-2"
							on:click={() => {
								onSelection(
									option,
								);
							}}
						>
							<!-- Left side: optional icon + name/subtitle -->
							<div
								class="flex items-center gap-2"
							>
								{#if option.icon}
									<svelte:component
										this={option.icon}
										class="h-4 w-4"
									/>
								{/if}

								<div
									class="flex flex-col text-left"
								>
									<span
										>{option.name}</span
									>
									<span
										class="text-sm text-surface-400"
										>{option.subtitle}</span
									>
								</div>
							</div>

							<!-- Right side: shortcut keys -->
							<div
								class="flex items-center gap-2"
							>
								{#if Array.isArray(option.action.keys)}
									{#if $marasiConfig.DesktopOS === "darwin"}
										<kbd
											class="kbd text-surface-400 text-sm"
											>{option
												.action
												.keys[0]}</kbd
										>
									{:else}
										<kbd
											class="kbd text-surface-400 text-sm"
											>{option
												.action
												.keys[1]}</kbd
										>
									{/if}
								{:else}
									<kbd
										class="kbd text-surface-400 text-sm"
										>{option
											.action
											.keys}</kbd
									>
								{/if}
							</div>
						</button>
					</li>
				{/each}
			</ul>
		</nav>
	{:else}
		<div class="autocomplete-empty {classesEmpty}">
			{@html emptyState}
		</div>
	{/if}
</div>

