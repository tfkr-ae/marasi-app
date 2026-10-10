import { MACOS } from "./platform.js";

// A binding is one logical key plus an explicit modifier set, stored as a
// canonical string: modifiers in the order meta, ctrl, alt, shift, then the
// key, joined by "+" (for example "meta+shift+[" or "ctrl+alt+1"). Keys are
// lowercase; named keys use the lowercase KeyboardEvent.key name
// ("enter", "arrowdown"), " " is "space" and "+" is "plus".

const MODIFIERS = ["meta", "ctrl", "alt", "shift"];

const MODIFIER_ALIASES = {
  meta: "meta",
  cmd: "meta",
  command: "meta",
  "⌘": "meta",
  ctrl: "ctrl",
  control: "ctrl",
  "⌃": "ctrl",
  alt: "alt",
  option: "alt",
  "⌥": "alt",
  shift: "shift",
  "⇧": "shift",
};

const KEY_ALIASES = {
  "↩": "enter",
  return: "enter",
  esc: "escape",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
  " ": "space",
  "+": "plus",
};

const NAMED_KEYS = new Set([
  "enter",
  "escape",
  "tab",
  "space",
  "plus",
  "backspace",
  "delete",
  "insert",
  "home",
  "end",
  "pageup",
  "pagedown",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
  ...Array.from({ length: 24 }, (_, i) => `f${i + 1}`),
]);

const MODIFIER_KEY_NAMES = new Set([
  "meta",
  "control",
  "alt",
  "altgraph",
  "shift",
  "os",
  "hyper",
  "super",
  "capslock",
  "fn",
  "fnlock",
  "numlock",
  "scrolllock",
  "symbol",
  "symbollock",
]);

// The character printed on the unshifted key of a US layout, by
// KeyboardEvent.code. Used only by the Shift/Option rule in logicalKey.
const BASE_BY_CODE = {
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
};

function baseFromCode(code) {
  if (typeof code !== "string") return null;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return BASE_BY_CODE[code] ?? null;
}

function isSingleCharacter(key) {
  return [...key].length === 1;
}

function isAsciiAlphanumeric(char) {
  return /^[a-z0-9]$/i.test(char);
}

function hasCase(char) {
  return char.toLowerCase() !== char.toUpperCase();
}

function canonicalKey(token) {
  const lower = token.toLowerCase();
  if (KEY_ALIASES[token] || KEY_ALIASES[lower]) {
    return KEY_ALIASES[token] || KEY_ALIASES[lower];
  }
  if (isSingleCharacter(token)) return lower;
  if (NAMED_KEYS.has(lower)) return lower;
  return null;
}

function compose(modifiers, key) {
  return [...MODIFIERS.filter((m) => modifiers.has(m)), key].join("+");
}

// Parses canonical bindings and the legacy menu notation ("⌘+⇧+F",
// "ctrl+⇧+enter", "⌘+⇧+↩"). Returns the canonical binding, or null when the
// text is not exactly one key plus known modifiers.
export function normalizeBinding(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  // A trailing "+" after a separator is the plus key itself ("meta++").
  const tokens = trimmed.endsWith("++")
    ? [...trimmed.slice(0, -2).split("+"), "+"]
    : trimmed === "+"
      ? ["+"]
      : trimmed.split("+");
  const keyToken = tokens.pop().trim();
  const modifiers = new Set();
  for (const token of tokens) {
    const modifier = MODIFIER_ALIASES[token.trim().toLowerCase()];
    if (!modifier) return null;
    modifiers.add(modifier);
  }
  if (!keyToken || MODIFIER_ALIASES[keyToken.toLowerCase()]) return null;
  const key = canonicalKey(keyToken);
  return key ? compose(modifiers, key) : null;
}

// The logical key of a keydown event.
//
// Keys are logical (KeyboardEvent.key), with one explicit exception for
// modifiers that rewrite the produced character:
// - With Option/Alt held, a character that is not an ASCII letter or digit
//   (macOS ⌥1 gives "¡", ⌥A gives "å", ⌥E is a dead key) resolves to the
//   base character of the physical key.
// - With Shift held, a character that has no letter case (US ⇧[ gives "{",
//   ⇧1 gives "!") resolves to the base character of the physical key.
//   Shifted letters, including non-ASCII ones such as "Ü", stay logical and
//   are lowercased.
// The base character comes from KeyboardEvent.code via a US table, so the
// factory defaults (⌘⇧[, ⌘⌥1) fire on real keyboards and display as the
// character printed on the key. Unshifted, un-Optioned characters are never
// remapped: on AZERTY ⌘ plus the "&" key is "meta+&", not "meta+1".
function logicalKey(event) {
  const key = event.key;
  if (!key || key === "Unidentified" || key === "Dead") {
    return event.altKey || event.shiftKey || key === "Dead"
      ? baseFromCode(event.code)
      : null;
  }
  if (MODIFIER_KEY_NAMES.has(key.toLowerCase())) return null;
  if (!isSingleCharacter(key)) return canonicalKey(key);
  let char = key.toLowerCase();
  const rewritten =
    (event.altKey && !isAsciiAlphanumeric(key)) ||
    (event.shiftKey && !hasCase(key));
  if (rewritten) char = baseFromCode(event.code) ?? char;
  return KEY_ALIASES[char] ?? char;
}

// The canonical binding for a keydown event, or null for modifier-only,
// composition (IME) and unidentifiable events.
export function bindingFromEvent(event) {
  if (!event || event.isComposing || event.keyCode === 229 || event.key === "Process") {
    return null;
  }
  const key = logicalKey(event);
  if (!key) return null;
  const modifiers = new Set();
  if (event.metaKey) modifiers.add("meta");
  if (event.ctrlKey) modifiers.add("ctrl");
  if (event.altKey) modifiers.add("alt");
  if (event.shiftKey) modifiers.add("shift");
  return compose(modifiers, key);
}

export function isModifiedBinding(binding) {
  return /^(meta|ctrl|alt)\+/.test(binding);
}

// Display labels keep the palette's existing notation ("⌘+⇧+F",
// "ctrl+alt+1", "⌘+⇧+↩", "ctrl+⇧+enter", "⌘+⇧+down").
const MODIFIER_LABELS = {
  [MACOS]: { meta: "⌘", ctrl: "ctrl", alt: "alt", shift: "⇧" },
  default: { meta: "meta", ctrl: "ctrl", alt: "alt", shift: "⇧" },
};

const KEY_LABELS = {
  arrowup: "up",
  arrowdown: "down",
  arrowleft: "left",
  arrowright: "right",
  plus: "+",
};

export function formatBinding(binding, platform) {
  if (!binding) return "";
  const parts = binding.split("+");
  const key = parts.pop();
  const labels = MODIFIER_LABELS[platform] ?? MODIFIER_LABELS.default;
  let keyLabel = KEY_LABELS[key] ?? key;
  if (key === "enter" && platform === MACOS) keyLabel = "↩";
  else if (isSingleCharacter(key)) keyLabel = key.toUpperCase();
  return [...parts.map((m) => labels[m] ?? m), keyLabel].join("+");
}
