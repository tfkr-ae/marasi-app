// The app's Text size (lib/textSize.js). readConfig in stores.js loads it from
// the app config before the first project opens, and the root layout applies
// it to the root element. After that, read it here, not from
// $marasiConfig.TextSize, which is only what the app started with.
import { writable } from "svelte/store";
import { SetFlag } from "../lib/wailsjs/go/main/App";
import { DEFAULT_TEXT_SIZE, rootFontSize } from "../lib/textSize.js";

/** The current Text size, one of TEXT_SIZES. */
export const textSize = writable(DEFAULT_TEXT_SIZE);

/** Changes the Text size and saves it app-wide. Every control that changes it goes through here. */
export function setTextSize(size) {
  textSize.set(size);
  SetFlag("text_size", size.id).catch((error) => console.error("saving the Text size:", error));
}

/** Sizes the root element, and so everything written in rem, for `size`. */
export function applyTextSize(size) {
  document.documentElement.style.fontSize = rootFontSize(size);
}
