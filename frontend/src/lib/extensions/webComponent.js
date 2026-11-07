// An extension's web component: the `ui_code` and `version` globals its Lua
// sets, which GET /extension/{id} returns. ui_code only registers custom
// elements (customElements.define); the app creates the instances. Each
// target's element is `<name>-<target>-<version>`, so a new version
// registers a new element: a registered tag can't be defined again.

/** The custom element tag for the extension `name` at `target` ("icon" or "extension"). */
export const webComponentTag = (name, target, version) => `${name}-${target}-${version}`;

/**
 * Runs `code` unless `tag` is already registered. `{error}` is null once
 * `tag` is registered, else what went wrong.
 */
export function defineWebComponent(tag, code, { registry = globalThis.customElements, run = (c) => new Function(c)() } = {}) {
  if (registry.get(tag)) return { error: null };
  try {
    run(code);
  } catch (err) {
    return { error: String(err?.message ?? err) };
  }
  return { error: registry.get(tag) ? null : `ui_code didn't define <${tag}>` };
}
