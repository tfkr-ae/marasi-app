// @pandatix/js-cvss imports its own files without extensions, which Vite
// resolves and plain Node does not; add the extension for it. Used by
// cvss.test.js on Node versions without module.registerHooks.
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (specifier.startsWith(".") && context.parentURL?.includes("@pandatix/js-cvss")) {
      return next(`${specifier}.js`, context);
    }
    throw err;
  }
}
