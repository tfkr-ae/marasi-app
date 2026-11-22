<script>
	// The streamed pair kind's Inject tab: a message for one open, streamed
	// direction, written as the protobuf text form for gRPC, gRPC-Web and
	// Connect and as UTF-8 text otherwise, with Send uncompressed. The draft
	// lives in streamedPairStore, so it survives switching tabs and Copy to
	// Inject can fill it. An inject Checkpoint holds shows "Held in
	// Checkpoint" until it is forwarded or dropped; the rest of the modal
	// stays usable meanwhile.
	import { getToastStore, modeCurrent } from "@skeletonlabs/skeleton";
	import { Send } from "lucide-svelte";
	import { primaryVariant } from "../launchpad/format.js";
	import { openDirections, streamedPairStore } from "../../stores/streamedPairStore.js";
	import MessageEditor from "./MessageEditor.svelte";

	export let pairId;

	const toastStore = getToastStore();
	const LABELS = { request: "↑ Request", response: "↓ Response" };
	const TEXT_FORM = new Set(["grpc", "grpc-web", "connect"]);

	// The text error Marasi named for the last inject: { line, column, message }.
	let refusal = null;

	$: pair = $streamedPairStore.pairs[pairId];
	$: open = openDirections(pair?.directions);
	$: draft = pair?.draft ?? { direction: null, text: "", neverCompress: false };
	// The chosen direction, or the first open one when it isn't open.
	$: direction = open.includes(draft.direction) ? draft.direction : (open[0] ?? null);
	$: framing = (direction && pair?.directions[direction]?.Framing) || "";
	$: textForm = TEXT_FORM.has(framing);
	$: pending = pair?.inject.pending ?? false;
	$: held = pair?.inject.held ?? false;

	let text = "";
	$: syncFromDraft(draft.text);
	function syncFromDraft(next) {
		if (next !== text) {
			text = next;
			refusal = null;
		}
	}
	$: if (pair && text !== draft.text) changeText(text);
	function changeText(next) {
		streamedPairStore.setDraft(pairId, { text: next });
		refusal = null;
	}

	const setDirection = (value) => streamedPairStore.setDraft(pairId, { direction: value });

	export function toggleDirection() {
		if (open.length < 2) return;
		setDirection(open[(open.indexOf(direction) + 1) % open.length]);
	}

	export async function inject() {
		if (!direction || pending) return;
		refusal = null;
		const outcome = await streamedPairStore.inject(pairId, {
			direction,
			text,
			neverCompress: draft.neverCompress,
		});
		if (outcome.ok) {
			const dropped = outcome.message?.Metadata?.dropped;
			toastStore.trigger({
				message: dropped ? "Injected message dropped" : "Message injected",
				background: dropped ? "variant-filled-warning" : "variant-filled-success",
			});
			return;
		}
		if (outcome.superseded || outcome.busy) return;
		if (outcome.line) {
			refusal = outcome;
			return;
		}
		toastStore.trigger({
			message: outcome.toast ?? `Unable to inject: ${outcome.message}`,
			background: "variant-filled-error",
		});
	}
</script>

<div class="flex h-full min-h-0 w-full flex-col">
	<div
		class="msg-bar flex h-10 shrink-0 items-center justify-between gap-2 border-b border-surface-500/30 bg-surface-100-800-token px-2 text-xs"
	>
		<div class="flex items-center gap-2">
			<label class="flex items-center gap-1.5 text-xs">
				<span class="opacity-60">Direction</span>
				<select
					class="select select-sm bg-white dark:bg-surface-700 border-0 ring-0 focus:border-0 focus:ring-0"
					value={direction ?? ""}
					disabled={!open.length}
					on:change={(event) => setDirection(event.currentTarget.value)}
				>
					{#each open as name (name)}
						<option value={name}>{LABELS[name]}</option>
					{:else}
						<option value="">No open direction</option>
					{/each}
				</select>
			</label>
			{#if framing}
				<span class="chip variant-soft-surface text-xs">{framing}</span>
			{/if}
			<label class="flex items-center gap-1.5 text-xs">
				<input
					type="checkbox"
					class="checkbox"
					checked={draft.neverCompress}
					on:change={(event) => streamedPairStore.setDraft(pairId, { neverCompress: event.currentTarget.checked })}
				/>
				Send uncompressed
			</label>
		</div>

		<div class="flex items-center gap-1">
			{#if held}
				<span class="chip variant-soft-warning text-xs" title="Forward or drop it in Checkpoint">Held in Checkpoint</span>
			{:else if !open.length && pair && !pair.loading}
				<span class="chip variant-soft-error text-xs">Stream closed</span>
			{/if}
			<button
				class="btn btn-sm {primaryVariant($modeCurrent)}"
				disabled={!direction || pending}
				on:click={inject}
			>
				<Send size={14} class="mr-1" />
				{pending ? "Injecting…" : "Inject"}
			</button>
		</div>
	</div>

	{#if refusal}
		<div class="shrink-0 border-b border-error-500/30 bg-error-500/10 px-3 py-1.5 text-xs text-error-500">
			Line {refusal.line}, column {refusal.column}: {refusal.message}
		</div>
	{/if}

	<div class="min-h-0 flex-1 overflow-auto">
		<MessageEditor bind:value={text} language={textForm ? "protobuf" : null} marker={refusal} />
	</div>
</div>
