// @ts-check
import { join } from 'path';

// 1. Import the Skeleton plugin
import { skeleton } from '@skeletonlabs/tw-plugin';
import { tfkrTheme } from './tfkr-theme'
import forms from '@tailwindcss/forms';
/** @type {import('tailwindcss').Config} */
export default {
	// 2. Opt for dark mode to be handled via the class method
	darkMode: 'selector',
	content: [
		'./src/**/*.{html,js,svelte,ts}',
		// 3. Append the path to the Skeleton package
		join(require.resolve(
			'@skeletonlabs/skeleton'),
			'../**/*.{html,js,svelte,ts}'
		)
	],
	theme: {
		extend: {
			// The dense end of the type scale, below text-xs. Sizes are in rem so
			// Text size scales them (docs/adr/2026-10-29-text-size-scales-the-root-font-size.md).
			// Font size only, with no line height, like the text-[11px] and
			// text-[10px] classes they replace.
			fontSize: {
				'2xs': '0.6875rem',
				'3xs': '0.625rem',
			},
		},
	},
	plugins: [
		forms,
		// 4. Append the Skeleton plugin (after other plugins)
		skeleton({
			themes: {custom: [tfkrTheme], preset: ["skeleton"]}
		})
	]
}
