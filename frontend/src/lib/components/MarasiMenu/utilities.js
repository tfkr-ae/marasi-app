import { readable } from 'svelte/store';
import { BROWSER } from 'esm-env';

/** Prefers reduced motion  */
const reducedMotionQuery = '(prefers-reduced-motion: reduce)';

function prefersReducedMotion() {
	if (!BROWSER) return false;
	return window.matchMedia(reducedMotionQuery).matches;
}

/**
 * Indicates that the user has enabled reduced motion on their device.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
 */
export const prefersReducedMotionStore = readable(prefersReducedMotion(), (set) => {
	if (BROWSER) {
		const setReducedMotion = (event) => {
			set(event.matches);
		};
		const mediaQueryList = window.matchMedia(reducedMotionQuery);
		mediaQueryList.addEventListener('change', setReducedMotion);

		return () => {
			mediaQueryList.removeEventListener('change', setReducedMotion);
		};
	}
});

// Transitions ---
export function dynamicTransition(node, dynParams) {
	const { transition, params, enabled } = dynParams;

	if (enabled) return transition(node, params);

	// it's better to just set the `duration` to 0 to prevent flickering
	if ('duration' in params) return transition(node, { duration: 0 });

	// if the transition doesn't provide a `duration` prop, then we'll just return this as a last resort
	return { duration: 0 };
}