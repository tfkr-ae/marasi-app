<script>
	// The camera viewfinder for a pairing QR code (iOS). The preview is a
	// native view laid over this box (qr_scan_ios.m), kept on it every frame
	// so the modal's transition, a fold or a rotation moves it too.
	// Dispatches `scanned` with the code's text (the scan then stops) and
	// `failed` with the reason the camera couldn't open.
	import { createEventDispatcher, onDestroy, onMount } from "svelte";
	import { MoveQRScan, StartQRScan, StopQRScan } from "../bindings/github.com/tfkr-ae/marasi-app/app.js";
	import { on } from "../runtime.js";
	import { rectMoved, scanRect } from "./pairing-view.js";

	const dispatch = createEventDispatcher();
	let box;
	let placed = null;
	let frame = 0;
	const unsubscribe = [];

	function follow() {
		if (!box) return;
		const rect = scanRect(box.getBoundingClientRect());
		if (rectMoved(placed, rect)) {
			placed = rect;
			MoveQRScan(rect).catch(() => {});
		}
		frame = requestAnimationFrame(follow);
	}

	onMount(() => {
		unsubscribe.push(on("qr-scan.result", (text) => dispatch("scanned", text)));
		unsubscribe.push(on("qr-scan.error", (reason) => dispatch("failed", reason)));
		placed = scanRect(box.getBoundingClientRect());
		StartQRScan(placed)
			.then(() => (frame = requestAnimationFrame(follow)))
			.catch((err) => dispatch("failed", String(err?.message ?? err)));
	});

	onDestroy(() => {
		cancelAnimationFrame(frame);
		for (const off of unsubscribe) off();
		StopQRScan().catch(() => {});
	});
</script>

<div
	bind:this={box}
	class="aspect-square w-full max-w-[18rem] bg-black"
	data-testid="qr-viewfinder"
	aria-label="Camera viewfinder"
	role="img"
></div>
