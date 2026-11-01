import { get } from "svelte/store";
import { extensions_ui } from "../../../stores";
import { extensionsStore } from "../../../stores/extensionsStore.js";

/**
 * Resolves a value that can be either a static primitive or a bound configuration object.
 * * @param {Object} uiState - The current value of the $extensions_ui store
 * @param {Object} extensionData - The extension's metadata (requires .Name)
 * @param {string|Object} value - The prop value (string/number or { default, bind })
 * @returns {any} The resolved value to display
 */
export function resolveBind(uiState, extensionData, value) {
    let bindKey = null;
    let fallback = value;

    if (typeof value === 'object' && value !== null) {
        bindKey = value.bind;
        fallback = value.default;
    }

    if (!bindKey || !extensionData || !uiState) {
        return fallback;
    }

    const remoteValue = uiState[extensionData.Name]?.state?.[bindKey];

    return (remoteValue !== undefined && remoteValue !== null) ? remoteValue : fallback;
}

/**
 * Updates a bound value in the global store.
 * * @param {Object} extensionData - The extension's metadata
 * @param {string|Object} valueConfig - The value prop (to extract bind key)
 * @param {any} newValue - The new value to set
 */
export function updateBind(extensionData, valueConfig, newValue) {
    let bindKey = null;

    if (typeof valueConfig === 'object' && valueConfig !== null) {
        bindKey = valueConfig.bind;
    }

    if (!bindKey || !extensionData) return;

    extensions_ui.update((store) => {
        const appState = store[extensionData.Name] || {};
        const currentState = appState.state || {};
        const newState = { ...currentState, [bindKey]: newValue };

        return {
            ...store,
            [extensionData.Name]: { ...appState, state: newState },
        };
    });
}

/**
 * Calls the extension's Lua function `fn` with the extension's UI, as v1's
 * extension_call_function did. A failed call (a function the extension
 * doesn't define, a Lua error) is logged, as v1 dropped it.
 * @param {Object} extensionData - The extension's metadata (requires .ID and .Name)
 * @param {string} fn - The Lua function's name
 */
export function callExtensionFunction(extensionData, fn) {
    const ui = get(extensions_ui)[extensionData.Name] ?? { state: {} };
    return extensionsStore
        .call(extensionData.ID, fn, [ui])
        .catch((error) => console.error(`Calling ${extensionData.Name}.${fn} failed:`, error));
}
