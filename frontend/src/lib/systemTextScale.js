// The phone's own text size (Android's Font size, iOS's Text Size) as a scale
// on the root font size, on top of the app's Text size. Everything in rem
// follows the root font size, so spacing grows with the text, as Text size
// does (docs/adr/2026-10-29-text-size-scales-the-root-font-size.md).
//
// - Android: MainActivity keeps the web view's text zoom at 100%, which
//   would grow only the text, and answers MarasiAndroid.textScale() with how
//   much the Font size grows 16sp text.
// - iOS: the web view leaves page text at its CSS size, so the scale is read
//   from a hidden probe set in -apple-system-body, iOS's body text, which
//   follows Text Size: 17px at the default size.
//
// The desktop keeps 1.

/** The smallest and largest system scale the app follows. */
export const SYSTEM_TEXT_SCALE_MIN = 0.8;
export const SYSTEM_TEXT_SCALE_MAX = 2;

/** iOS's body text size at the default Text Size, in CSS px. */
const IOS_BODY_PX = 17;

/** `value` as a usable scale: 1 when it isn't a positive number, else held to the range and rounded to 0.01. */
export function systemTextScaleFrom(value) {
	const scale = Number(value);
	if (!Number.isFinite(scale) || scale <= 0) return 1;
	const held = Math.min(SYSTEM_TEXT_SCALE_MAX, Math.max(SYSTEM_TEXT_SCALE_MIN, scale));
	return Math.round(held * 100) / 100;
}

function bodyProbe(doc) {
	const probe = doc.createElement("span");
	probe.setAttribute("aria-hidden", "true");
	probe.style.cssText =
		"position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;font:-apple-system-body";
	probe.textContent = "M";
	doc.body.appendChild(probe);
	return probe;
}

function iosScale(doc, probe) {
	return systemTextScaleFrom(parseFloat(doc.defaultView.getComputedStyle(probe).fontSize) / IOS_BODY_PX);
}

/** The phone's text scale on `platform` ("ios", "android" or "desktop"). */
export function readSystemTextScale(platform, win = window) {
	try {
		if (platform === "android") return systemTextScaleFrom(win.MarasiAndroid?.textScale?.());
		if (platform === "ios" && win.document?.body) {
			const probe = bodyProbe(win.document);
			try {
				return iosScale(win.document, probe);
			} finally {
				probe.remove();
			}
		}
	} catch {
		// Fall through to 1.
	}
	return 1;
}

/**
 * Calls `onScale` with the phone's text scale now and whenever it may have
 * changed. On iOS, Text Size changes while the app runs: the probe stays in
 * the page, and WebKit resizes it when the size changes. Coming back to the
 * front reads it again too. Android restarts the activity, and so the page,
 * when its Font size changes. Returns a stop function.
 */
export function watchSystemTextScale(platform, onScale, win = window) {
	if (platform === "android") {
		onScale(readSystemTextScale(platform, win));
		return () => {};
	}
	if (platform !== "ios" || !win.document?.body) {
		onScale(1);
		return () => {};
	}
	const doc = win.document;
	const probe = bodyProbe(doc);
	const read = () => {
		try {
			onScale(iosScale(doc, probe));
		} catch {
			onScale(1);
		}
	};
	read();
	const resizes = win.ResizeObserver ? new win.ResizeObserver(read) : null;
	resizes?.observe(probe);
	const onVisible = () => {
		if (doc.visibilityState === "visible") read();
	};
	doc.addEventListener("visibilitychange", onVisible);
	return () => {
		resizes?.disconnect();
		doc.removeEventListener("visibilitychange", onVisible);
		probe.remove();
	};
}
