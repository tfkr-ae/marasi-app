<script>
	// The streamed pair kind's Checkpoint tab: the pair's held stream
	// messages and trailer blocks, oldest first, with the selected one in
	// MessageEditor and Forward and Drop. Everything lives in checkpointStore,
	// as on the Checkpoint page, so an edit, a Forward or a Drop in either
	// view shows in the other. The Stream intercept switch is the dock's.
	import { getToastStore, modeCurrent } from "@skeletonlabs/skeleton";
	import { CornerLeftDown, Forward } from "lucide-svelte";
	import { primaryVariant } from "../launchpad/format.js";
	import { directionArrow } from "./kinds.js";
	import { messageTime, textLanguage } from "./streamMessage.js";
	import { streamedPairStore } from "../../stores/streamedPairStore.js";
	import { checkpointStore, heldOfPair, isDirty, refusalOf, textOf } from "../../stores/checkpointStore";
	import KindTag from "../checkpoint/KindTag.svelte";
	import { reportFailure, settleItem } from "../checkpoint/settle.js";
	import StreamInterceptToggle from "../checkpoint/StreamInterceptToggle.svelte";
	import MessageEditor from "./MessageEditor.svelte";

	export let pairId;

	const toastStore = getToastStore();
	const store = checkpointStore;

	let selectedId = null;
	let busy = false;

	$: state = $store;
	$: held = heldOfPair(state, pairId);
	// The selected item, else the oldest once it leaves.
	$: selected = held.find((item) => item.ID === selectedId) ?? held[0] ?? null;
	$: refusal = selected ? refusalOf(state, selected.ID) : null;
	// A text form's highlighting by the pair's codec where the modal read it;
	// Checkpoint alone knows no codec and goes by the text.
	$: codec = $streamedPairStore.pairs[pairId]?.codecs?.[selected?.Direction] ?? null;
	$: language = selected?.textForm && codec ? textLanguage(selected.text, codec) : (selected?.language ?? null);
	$: primary = primaryVariant($modeCurrent);

	function toast(message, background = "variant-filled-surface") {
		toastStore.trigger({ message, background, timeout: 3000 });
	}

	// As the Checkpoint page reports a single Forward or Drop.
	async function settle(what, run) {
		if (!selected || busy) return;
		busy = true;
		const id = selected.ID;
		try {
			await settleItem(what, () => run(id), toast);
		} finally {
			busy = false;
		}
	}

	export const forward = () => settle("Forward", (id) => store.forward(id));
	export const drop = () => settle("Drop", (id) => store.drop(id));

	export async function toggleIntercept() {
		try {
			await store.toggleStreamIntercept();
		} catch (err) {
			reportFailure("Stream intercept", err, toast);
		}
	}
</script>

<div class="flex h-full min-h-0 w-full flex-col">
	<div
		class="msg-bar flex h-10 shrink-0 items-center justify-between gap-3 border-b border-surface-500/30 bg-surface-100-800-token px-2 text-xs"
	>
		<div class="flex items-center gap-3">
			<span class="chip variant-soft-surface text-xs">{held.length ? `${held.length} intercepted` : "Nothing intercepted"}</span>
			<StreamInterceptToggle class="stream-intercept" checked={state.streamIntercept} onToggle={toggleIntercept} />
		</div>
		<div class="flex shrink-0 items-center gap-1">
			<button class="btn btn-sm {primary}" disabled={!selected || busy} on:click={forward}>
				<Forward size={14} class="mr-1" />Forward
			</button>
			<button class="btn btn-sm {primary}" disabled={!selected || busy} on:click={drop}>
				<CornerLeftDown size={14} class="mr-1" />Drop
			</button>
		</div>
	</div>

	{#if held.length}
		<div class="sc-panes grid min-h-0 flex-1 grid-cols-[16rem_1fr]">
			<ul class="sc-list min-h-0 overflow-auto border-r border-surface-500/30" aria-label="Intercepted messages">
				{#each held as item (item.ID)}
					{@const arrow = directionArrow(item.Direction === "request")}
					<li>
						<button
							class="relative flex w-full items-center gap-2 border-b border-surface-500/20 px-2 py-1.5 text-left font-mono text-2xs {item.ID ===
							selected?.ID
								? 'bg-primary-500/20'
								: 'hover:bg-surface-200/70 dark:hover:bg-surface-700/60'}"
							aria-current={item.ID === selected?.ID}
							on:click={() => (selectedId = item.ID)}
						>
							{#if item.ID === selected?.ID}<span class="absolute bottom-0 left-0 top-0 w-[3px] bg-primary-500"></span>{/if}
							<span class={arrow.class}>{arrow.glyph}</span>
							<KindTag type={item.Type} />
							<span class="flex-1 truncate opacity-70">{item.Framing ?? ""}</span>
							{#if isDirty(state, item.ID)}<span class="text-warning-500" title="Edited">●</span>{/if}
							<span class="opacity-60">{messageTime(item.InterceptedAt)}</span>
						</button>
					</li>
				{/each}
			</ul>

			{#key selected.ID}
				<section class="flex min-h-0 min-w-0 flex-col">
					<div class="msg-bar flex h-8 shrink-0 items-center gap-2 border-b border-surface-500/30 px-3 text-2xs">
						<span class="font-bold">
							{selected.Type === "trailer" ? "Trailers" : "Message"} · {selected.Direction === "request"
								? "Client → server"
								: "Server → client"}
						</span>
						{#if isDirty(state, selected.ID)}
							<button class="btn btn-sm {primary} px-2 py-0 text-2xs" on:click={() => store.edit(selected.ID, selected.text)}
								>Revert</button
							>
						{/if}
						{#if selected.Type === "stream" && !selected.editable}
							<span class="opacity-60">No text form; shown as hex, read-only</span>
						{/if}
					</div>
					<div class="min-h-0 flex-1 overflow-auto dark:bg-[#282c34]">
						<MessageEditor
							value={textOf(state, selected.ID)}
							{language}
							readonly={!selected.editable}
							errorAt={refusal}
							on:change={(event) => store.edit(selected.ID, event.detail)}
						/>
					</div>
					{#if refusal}
						<div class="border-t border-surface-500/30 px-3 py-1 text-2xs text-error-500">{refusal.message}</div>
					{/if}
				</section>
			{/key}
		</div>
	{:else}
		<div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 text-xs opacity-60">
			<span>No intercepted messages for this pair</span>
			<span>{state.streamIntercept ? "Stream intercept is on" : "Turn on Stream intercept to intercept its messages"}</span>
		</div>
	{/if}
</div>

<style>
	@media (max-width: 40rem) {
		:global(html.mobile .sc-panes) {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: minmax(0, 10rem) minmax(0, 1fr);
		}
		:global(html.mobile .sc-list) {
			border-right-width: 0;
			border-bottom-width: 1px;
		}
	}
</style>
