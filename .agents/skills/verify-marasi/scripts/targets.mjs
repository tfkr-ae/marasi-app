// Target resolution for the driver. A control is clickable only when exactly
// one match receives a hit-test at its centre, is enabled, and keeps the same
// box across two polls. Anything else keeps the driver waiting, and the last
// reason becomes the timeout error so a wrong selector names its matches.

const textControls = "button, a, [role=button], [role=switch], [role=tab], [role=menuitem], [role=option], label, summary";

/**
 * Browser expression that lists the matches for `spec` and keeps them on
 * `window.__verifyTargets` so the driver can scroll the chosen one.
 * spec: {selector} or {text}, optionally {within} to scope by a CSS root and
 * {hasText} to keep selector matches whose text contains it.
 */
export function collectExpression(spec) {
	return `(() => {
		const spec = ${JSON.stringify(spec)};
		const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim();
		const roots = spec.within ? Array.from(document.querySelectorAll(spec.within)) : [document];
		let elements = [];
		for (const root of roots) {
			const found = spec.selector
				? Array.from(root.querySelectorAll(spec.selector))
				: Array.from(root.querySelectorAll(${JSON.stringify(textControls)})).filter((el) =>
					normalize(el.innerText) === spec.text
					|| normalize(el.getAttribute("aria-label")) === spec.text
					|| normalize(el.getAttribute("title")) === spec.text);
			elements.push(...found);
		}
		elements = Array.from(new Set(elements));
		if (spec.hasText) elements = elements.filter((el) => normalize(el.innerText).includes(spec.hasText));
		// A text match on a wrapper and its inner control names one control.
		if (!spec.selector) elements = elements.filter((el) => !elements.some((other) => other !== el && el.contains(other)));
		window.__verifyTargets = elements;
		return elements.map((el, index) => {
			const box = el.getBoundingClientRect();
			const x = box.left + box.width / 2;
			const y = box.top + box.height / 2;
			const inViewport = x >= 0 && y >= 0 && x < innerWidth && y < innerHeight;
			const hit = inViewport ? document.elementFromPoint(x, y) : null;
			return {
				index,
				description: el.tagName.toLowerCase()
					+ (el.id ? "#" + el.id : "")
					+ (el.getAttribute("title") ? '[title="' + el.getAttribute("title") + '"]' : "")
					+ ' "' + normalize(el.innerText).slice(0, 40) + '"',
				x, y, width: box.width, height: box.height,
				inViewport,
				hittable: Boolean(hit && (hit === el || el.contains(hit))),
				coveredBy: hit && hit !== el && !el.contains(hit) ? hit.tagName.toLowerCase() + (hit.className && typeof hit.className === "string" ? "." + hit.className.trim().split(/\\s+/).slice(0, 3).join(".") : "") : null,
				disabled: Boolean(el.disabled || el.getAttribute("aria-disabled") === "true" || el.closest("fieldset[disabled]")),
			};
		});
	})()`;
}

function describe(candidate) {
	const state = !(candidate.width > 0 && candidate.height > 0) ? "zero box"
		: !candidate.inViewport ? "outside viewport"
		: !candidate.hittable ? `covered by ${candidate.coveredBy || "nothing"}`
		: candidate.disabled ? "disabled"
		: "actionable";
	return `${candidate.description} (${state})`;
}

/**
 * Chooses the target from collected candidates.
 * Returns {target}, {scroll: index} when the only unique match is off screen,
 * or {pending: reason} while the driver should keep waiting.
 * `nth` (1-based) picks among several actionable matches on purpose.
 * `enabled: false` accepts a disabled match, for asserting presence only.
 */
export function pickTarget(candidates, { nth, enabled = true } = {}) {
	if (!candidates.length) return { pending: "no element matches" };
	const painted = candidates.filter((candidate) => candidate.width > 0 && candidate.height > 0);
	const offscreen = painted.filter((candidate) => !candidate.inViewport);
	const hittable = painted.filter((candidate) => candidate.hittable);
	if (!hittable.length) {
		if (painted.length === 1 && offscreen.length === 1) return { scroll: offscreen[0].index };
		return { pending: `no match receives a click: ${candidates.map(describe).join("; ")}` };
	}
	let chosen;
	if (nth) {
		chosen = hittable[nth - 1];
		if (!chosen) return { pending: `wanted match ${nth} of ${hittable.length}: ${hittable.map(describe).join("; ")}` };
	} else if (hittable.length > 1) {
		return { pending: `${hittable.length} matches receive a click; refine the selector or pass nth: ${hittable.map(describe).join("; ")}` };
	} else {
		chosen = hittable[0];
	}
	if (enabled && chosen.disabled) return { pending: `match is disabled: ${describe(chosen)}` };
	return { target: chosen };
}

/** True when two candidate boxes are the same, so the target is not moving. */
export function sameBox(a, b) {
	return Boolean(a && b)
		&& Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5
		&& Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
}
