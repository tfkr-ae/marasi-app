<script>
	// A row's badges in fixed 14px slots, left-aligned, so every row's
	// badges line up. Past three, the third slot reads "+N"; hovering it
	// lists every badge with its label in a fixed-positioned tooltip, so the
	// table cell doesn't clip it.
	import { Edit2Icon, EditIcon, FlagIcon, Radio, Replace, SendIcon, Swords } from "lucide-svelte";
	import { badgeSlots, rowBadges } from "./table.js";

	export let row;

	const ICONS = {
		websocket: Radio,
		launchpad: SendIcon,
		armory: Swords,
		intercepted: FlagIcon,
		"edited-request": EditIcon,
		"edited-response": EditIcon,
		note: Edit2Icon,
		"override-host": Replace,
	};

	$: badges = rowBadges(row);
	$: slots = badgeSlots(badges);

	let tip = null;
	function showTip(event) {
		const rect = event.currentTarget.getBoundingClientRect();
		tip = { left: rect.left, top: rect.bottom + 4 };
	}
</script>

<span class="inline-flex items-center align-middle">
	{#each slots.visible as badge (badge.key)}
		<span
			class="relative inline-flex w-[14px] justify-center {badge.tone || 'opacity-60'}"
			title={badge.label}
			aria-label={badge.label}
		>
			<svelte:component this={ICONS[badge.key]} size={11} />
			{#if badge.slashed}
				<svg
					class="pointer-events-none absolute inset-0 m-auto"
					width="11"
					height="11"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					aria-hidden="true"
				>
					<line x1="3" y1="3" x2="21" y2="21" />
				</svg>
			{/if}
		</span>
	{/each}
	{#if slots.more}
		<!-- svelte-ignore a11y-no-static-element-interactions -->
		<span
			class="ledger-badges-more inline-flex w-[14px] cursor-default justify-center text-3xs text-black/60 [text-box:trim-both_cap_alphabetic] hover:text-black dark:text-surface-50/60 dark:hover:text-surface-50"
			on:mouseenter={showTip}
			on:mouseleave={() => (tip = null)}>+{slots.more}</span
		>
	{/if}
</span>

{#if tip}
	<div
		class="pointer-events-none fixed z-[80] space-y-1 border border-surface-300-600-token bg-surface-100-800-token px-2 py-1.5 font-sans text-2xs shadow-xl"
		style="left: {tip.left}px; top: {tip.top}px"
		role="tooltip"
	>
		{#each badges as badge (badge.key)}
			<div class="flex items-center gap-2">
				<span class="inline-flex {badge.tone || 'opacity-70'}"
					><svelte:component this={ICONS[badge.key]} size={11} /></span
				>{badge.label}
			</div>
		{/each}
	</div>
{/if}
