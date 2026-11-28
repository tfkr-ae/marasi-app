<script>
	// Unified offline, scriptless HTTP response renderer shared across Ledger,
	// Launchpad, Armory, Logbook, and Checkpoint.
	// - HTML renders in <iframe sandbox="" referrerpolicy="no-referrer" srcdoc>
	//   on a white canvas with pre-render sanitization and strict CSP injection.
	// - SVG renders strictly via <img src={blobUrl}> (never inline DOM).
	// - Raster images, video, and audio render via revoked blob: URLs; media
	//   never sets autoplay and gates uncompressed payloads over 10 MiB.
	import { onDestroy } from "svelte";
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import { AlertTriangle, Code2, Globe, Maximize2, Minimize2, ShieldAlert } from "lucide-svelte";
	import { neutralVariant, primaryVariant } from "../launchpad/format.js";
	import { formatSize } from "../ledger/table.js";
	import { classifyResponse } from "./classify.js";
	import { decodeResponseBody, MAX_DECODED_BYTES } from "./decodeBody.js";
	import { decodeHtmlText, parseRawResponse } from "./httpResponse.js";
	import { prepareOfflineHtml } from "./sanitizeHtml.js";

	/** Exact raw HTTP response bytes (preferred). */
	export let rawBytes = null;
	/** Fallback UTF-8 raw HTTP response text when rawBytes is unavailable. */
	export let rawText = "";
	/** Fallback Content-Type from pair metadata if header is absent. */
	export let contentType = "";
	/** Optional HTTP status code hint. */
	export let statusCode = 0;
	/** Optional indicator that Marasi truncated the stored response body. */
	export let truncated = false;
	/** Whether Browser view is eligible for this response. */
	export let canBrowserView = false;
	/** Copies the Browser view URL when clicked in the HTML offline notice strip. */
	export let onBrowserView = null;
	/** Switches the parent response pane back to Raw. */
	export let onShowRaw = () => {};

	const encoder = new TextEncoder();

	$: primary = primaryVariant($modeCurrent);
	$: neutral = neutralVariant($modeCurrent);

	// Stale-run guard so stepping quickly between pairs never applies an older decode.
	let runSeq = 0;
	let blobUrl = null;

	// Click-to-load override for a specific large (>10 MiB) uncompressed media payload.
	let allowLargeKey = null;
	let actualSize = false;
	let naturalDims = null;
	let mediaError = false;

	/**
	 * Render state machine:
	 * - { status: "loading" }
	 * - { status: "empty", partialNotice }
	 * - { status: "gate", kind, mime, size, gateKey, partialNotice }
	 * - { status: "unsupported", mime, message, partialNotice }
	 * - { status: "error", message, partialNotice }
	 * - { status: "html", mime, size, srcdoc, blockedScripts, blockedResources, partialNotice }
	 * - { status: "image" | "svg" | "video" | "audio", mime, size, url, partialNotice }
	 */
	let state = { status: "loading" };

	function revokeBlob() {
		if (blobUrl) {
			URL.revokeObjectURL(blobUrl);
			blobUrl = null;
		}
	}

	onDestroy(revokeBlob);

	function noticeSummary(blockedScripts, blockedResources) {
		const parts = [];
		if (blockedScripts > 0) parts.push(`${blockedScripts} ${blockedScripts === 1 ? "script" : "scripts"}`);
		if (blockedResources > 0) {
			parts.push(`${blockedResources} external ${blockedResources === 1 ? "resource" : "resources"}`);
		}
		if (parts.length === 0) return "";
		return `Offline preview · ${parts.join(" and ")} blocked`;
	}

	function partialNoticeFor(code, isTruncated) {
		if (code === 206) return "Partial response (206) — preview may be incomplete";
		if (isTruncated) return "Response body was truncated — preview may be incomplete";
		return "";
	}

	$: effectiveBytes =
		rawBytes instanceof Uint8Array
			? rawBytes
			: rawText
				? encoder.encode(rawText)
				: null;

	$: runRender(effectiveBytes, contentType, statusCode, truncated, allowLargeKey);

	async function runRender(bytes, fallbackType, fallbackStatus, isTruncated, unlockedGateKey) {
		const seq = ++runSeq;
		revokeBlob();
		actualSize = false;
		naturalDims = null;
		mediaError = false;

		if (!bytes || bytes.length === 0) {
			state = { status: "empty", partialNotice: partialNoticeFor(Number(fallbackStatus) || 0, isTruncated) };
			return;
		}

		const parsed = parseRawResponse(bytes, {
			fallbackContentType: fallbackType,
			fallbackStatusCode: fallbackStatus,
		});
		const code = parsed.statusCode || Number(fallbackStatus) || 0;
		const partialNotice = partialNoticeFor(code, isTruncated);

		if (parsed.bodyBytes.length === 0) {
			state = { status: "empty", partialNotice };
			return;
		}

		// For uncompressed payloads >10 MiB, classify before allocating a large media Blob or HTML string.
		if (parsed.contentEncodings.length === 0 && parsed.bodyBytes.length > MAX_DECODED_BYTES) {
			const pre = classifyResponse({ contentType: parsed.contentType, bodyBytes: parsed.bodyBytes });
			if (pre.kind === "unsupported") {
				state = {
					status: "unsupported",
					mime: pre.mime,
					message: pre.mime ? `Cannot render ${pre.mime}` : "Cannot render this response",
					partialNotice,
				};
				return;
			}
			if (pre.kind === "html") {
				state = {
					status: "error",
					message: "HTML response exceeds the 10 MiB render limit",
					partialNotice,
				};
				return;
			}
			const gateKey = `${bytes.length}:${parsed.bodyBytes.length}:${pre.mime}`;
			if (unlockedGateKey !== gateKey) {
				state = {
					status: "gate",
					kind: pre.kind,
					mime: pre.mime,
					size: parsed.bodyBytes.length,
					gateKey,
					partialNotice,
				};
				return;
			}
		}

		if (parsed.contentEncodings.length > 0) {
			state = { status: "loading" };
		}

		const decoded = await decodeResponseBody(parsed.bodyBytes, parsed.contentEncodings, {
			maxBytes: MAX_DECODED_BYTES,
		});
		if (seq !== runSeq) return;

		if (!decoded.ok) {
			state = { status: "error", message: decoded.message, partialNotice };
			return;
		}

		if (decoded.bytes.length === 0) {
			state = { status: "empty", partialNotice };
			return;
		}

		const classified = classifyResponse({ contentType: parsed.contentType, bodyBytes: decoded.bytes });
		if (classified.kind === "unsupported") {
			state = {
				status: "unsupported",
				mime: classified.mime,
				message: classified.mime ? `Cannot render ${classified.mime}` : "Cannot render this response",
				partialNotice,
			};
			return;
		}

		if (classified.kind === "html") {
			if (decoded.bytes.length > MAX_DECODED_BYTES) {
				state = {
					status: "error",
					message: "HTML response exceeds the 10 MiB render limit",
					partialNotice,
				};
				return;
			}
			const htmlText = decodeHtmlText(decoded.bytes, { charset: parsed.charset });
			const prepared = prepareOfflineHtml(htmlText);
			if (seq !== runSeq) return;
			state = {
				status: "html",
				mime: classified.mime,
				size: decoded.bytes.length,
				srcdoc: prepared.srcdoc,
				blockedScripts: prepared.blockedScripts,
				blockedResources: prepared.blockedResources,
				partialNotice,
			};
			return;
		}

		// Image, SVG (strictly via <img>), video, or audio via revoked blob: URL.
		const url = URL.createObjectURL(new Blob([decoded.bytes], { type: classified.mime }));
		blobUrl = url;
		state = {
			status: classified.kind,
			mime: classified.mime,
			size: decoded.bytes.length,
			url,
			partialNotice,
		};
	}

	function onImageLoad(event) {
		const img = event.currentTarget;
		if (img?.naturalWidth && img?.naturalHeight) {
			naturalDims = { width: img.naturalWidth, height: img.naturalHeight };
		}
	}

	function onMediaError() {
		mediaError = true;
	}

	const quietBtn = "inline-flex flex-none items-center gap-1 p-0.5 text-3xs opacity-70 hover:opacity-100";
</script>

<div
	class="response-render-pane flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-surface-100/60 text-2xs dark:bg-surface-900/60"
	data-render-status={mediaError ? "media-error" : state.status}
>
	{#if state.partialNotice}
		<div
			class="response-render-partial flex h-6 flex-none items-center gap-1.5 border-b border-surface-300-600-token bg-warning-500/15 px-2.5 text-3xs text-warning-800 dark:text-warning-300"
		>
			<AlertTriangle size={11} class="flex-none" />
			<span class="min-w-0 flex-1 truncate">{state.partialNotice}</span>
		</div>
	{/if}

	{#if state.status === "loading"}
		<div class="flex min-h-0 flex-1 items-center justify-center p-6">
			<p class="text-2xs opacity-60">Decoding response…</p>
		</div>
	{:else if state.status === "empty"}
		<div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
			<p class="text-2xs opacity-70">Empty response body</p>
			<button type="button" class="btn btn-sm rounded-none text-2xs {neutral}" on:click={onShowRaw}>
				<Code2 size={12} class="mr-1" />Switch to Raw
			</button>
		</div>
	{:else if state.status === "gate"}
		<div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
			<p class="text-2xs font-semibold">Large {state.kind} response ({formatSize(state.size)})</p>
			<p class="text-3xs opacity-60">{state.mime} · Exceeds the 10 MiB auto-load limit</p>
			<div class="mt-1 flex items-center gap-2">
				<button
					type="button"
					class="btn btn-sm rounded-none text-2xs {primary}"
					on:click={() => (allowLargeKey = state.gateKey)}
				>
					Load preview
				</button>
				<button type="button" class="btn btn-sm rounded-none text-2xs {neutral}" on:click={onShowRaw}>
					Switch to Raw
				</button>
			</div>
		</div>
	{:else if state.status === "unsupported" || state.status === "error"}
		<div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
			<p class="text-2xs opacity-75">{state.message}</p>
			<button type="button" class="btn btn-sm rounded-none text-2xs {neutral}" on:click={onShowRaw}>
				<Code2 size={12} class="mr-1" />Switch to Raw
			</button>
		</div>
	{:else if mediaError}
		<div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
			<p class="text-2xs opacity-75">This webview couldn't decode {state.mime}</p>
			<button type="button" class="btn btn-sm rounded-none text-2xs {neutral}" on:click={onShowRaw}>
				<Code2 size={12} class="mr-1" />Switch to Raw
			</button>
		</div>
	{:else if state.status === "html"}
		{#if state.blockedScripts > 0 || state.blockedResources > 0}
			<div
				class="response-render-notice flex h-6 flex-none items-center justify-between gap-2 border-b border-surface-300-600-token bg-surface-50 px-2.5 text-3xs dark:bg-surface-900"
			>
				<span class="flex min-w-0 items-center gap-1.5 truncate opacity-75">
					<ShieldAlert size={11} class="flex-none opacity-75" />
					<span class="truncate">{noticeSummary(state.blockedScripts, state.blockedResources)}</span>
				</span>
				{#if canBrowserView && onBrowserView}
					<button
						type="button"
						class="response-render-browser-view {quietBtn} text-primary-500 opacity-90 hover:opacity-100"
						on:click={onBrowserView}
					>
						<Globe size={11} /><span>Copy browser view URL</span>
					</button>
				{/if}
			</div>
		{/if}
		<iframe
			sandbox=""
			referrerpolicy="no-referrer"
			srcdoc={state.srcdoc}
			title="Rendered response"
			class="response-render-iframe min-h-0 w-full flex-1 border-0 bg-white"
		></iframe>
	{:else if state.status === "image" || state.status === "svg"}
		<div
			class="response-render-media-bar flex h-6 flex-none items-center justify-between gap-2 border-b border-surface-300-600-token bg-surface-50 px-2.5 text-3xs dark:bg-surface-900"
		>
			<span class="truncate font-mono opacity-65">
				{state.mime}{#if naturalDims} · {naturalDims.width} × {naturalDims.height}{/if} · {formatSize(state.size)}
			</span>
			<button
				type="button"
				class={quietBtn}
				title={actualSize ? "Fit" : "Actual size"}
				aria-label={actualSize ? "Fit" : "Actual size"}
				on:click={() => (actualSize = !actualSize)}
			>
				{#if actualSize}<Minimize2 size={11} /><span>Fit</span>{:else}<Maximize2 size={11} /><span>Actual size</span>{/if}
			</button>
		</div>
		<div class="response-render-image-stage min-h-0 flex-1 overflow-auto">
			<div class="flex min-h-full items-center justify-center p-3">
				<img
					src={state.url}
					alt={state.status === "svg" ? "Rendered SVG" : "Rendered image"}
					class={actualSize ? "max-w-none" : "max-h-full max-w-full object-contain"}
					on:load={onImageLoad}
					on:error={onMediaError}
				/>
			</div>
		</div>
	{:else if state.status === "video"}
		<div
			class="response-render-media-bar flex h-6 flex-none items-center justify-between gap-2 border-b border-surface-300-600-token bg-surface-50 px-2.5 text-3xs dark:bg-surface-900"
		>
			<span class="truncate font-mono opacity-65">{state.mime} · {formatSize(state.size)}</span>
		</div>
		<div class="flex min-h-0 flex-1 items-center justify-center bg-black p-2">
			<!-- svelte-ignore a11y-media-has-caption -->
			<video
				src={state.url}
				controls
				preload="metadata"
				class="max-h-full max-w-full"
				on:error={onMediaError}
			></video>
		</div>
	{:else if state.status === "audio"}
		<div
			class="response-render-media-bar flex h-6 flex-none items-center justify-between gap-2 border-b border-surface-300-600-token bg-surface-50 px-2.5 text-3xs dark:bg-surface-900"
		>
			<span class="truncate font-mono opacity-65">{state.mime} · {formatSize(state.size)}</span>
		</div>
		<div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6">
			<audio
				src={state.url}
				controls
				preload="metadata"
				class="w-full max-w-md"
				on:error={onMediaError}
			></audio>
		</div>
	{/if}
</div>
