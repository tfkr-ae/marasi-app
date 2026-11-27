// Activation seam for Interactsh, which stays lazily mounted in the layout
// once opened so its iframe keeps its state across route changes.
// +layout.svelte registers the lazy-load/visibility callbacks; both the app
// rail and GlobalMenu.svelte's `global.go-interact` handler activate it
// through the same path so the iframe exists in the DOM before `/interact`
// mounts.
export function createInteractActivator() {
	let current = null;

	return {
		register({ load, show, tick }) {
			const entry = {
				load,
				show,
				tick,
				loaded: false,
				loading: null,
			};
			current = entry;
			return () => {
				if (current === entry) current = null;
			};
		},

		async activate(navigate) {
			const entry = current;
			if (entry) {
				if (!entry.loaded) {
					if (!entry.loading) {
						entry.loading = new Promise((resolve) => resolve(entry.load())).then(
							() => {
								entry.loaded = true;
								entry.loading = null;
							},
							(error) => {
								entry.loading = null;
								throw error;
							},
						);
					}
					await entry.loading;
				}
				entry.show?.();
				if (entry.tick) await entry.tick();
			}
			return navigate?.();
		},
	};
}

export const interactActivator = createInteractActivator();
