// The licence half of the tool contract checks (scripts/check-tools.sh):
// the packages each tool bundles, read from its installed lockfile, may not
// be GPL or AGPL, and each must declare a licence or have an allow-list
// entry that says why it may ship.

// GPL-2.0, GPL-3.0-or-later, AGPL-3.0, GPL-2.0+, plain "GPL"; not LGPL.
const COPYLEFT = /^A?GPL(-|\+|$)/i;

// SPDX expressions as npm packages write them: ids joined by OR and AND,
// with brackets. A choice (OR) is fine when one side is; a conjunction (AND)
// only when both are. Precedence is ignored: every expression in the trees
// is flat.
function isCopyleft(expression) {
  const text = expression.replace(/[()]/g, " ").trim();
  if (/\s+OR\s+/i.test(text)) return text.split(/\s+OR\s+/i).every(isCopyleft);
  if (/\s+AND\s+/i.test(text)) return text.split(/\s+AND\s+/i).some(isCopyleft);
  return COPYLEFT.test(text.replace(/\s+WITH\s+.*$/i, ""));
}

function declared(license) {
  if (typeof license === "string") return license.trim();
  return license?.type?.trim() ?? "";
}

/** The licence a package.json declares: `license`, or the old `licenses` array as a choice. */
export function declaredLicence(packageJson) {
  const own = declared(packageJson?.license);
  if (own) return own;
  const ids = (Array.isArray(packageJson?.licenses) ? packageJson.licenses : []).map(declared).filter(Boolean);
  return ids.length > 1 ? `(${ids.join(" OR ")})` : (ids[0] ?? "");
}

/**
 * The problems with `packages` ([{ name, version, license }]): a GPL or
 * AGPL licence, a missing licence without an allow-list reason, or an
 * allow-list entry for a package that now declares one. `allow` maps a
 * package name to the reason it may ship without a declared licence.
 */
export function licenceProblems(packages, allow) {
  const problems = [];
  for (const { name, version, license } of packages) {
    const id = declared(license);
    const problem = (text) => problems.push({ name, version, problem: text });
    if (id) {
      if (isCopyleft(id)) problem(`is ${id}, a copyleft licence the app can't ship`);
      else if (name in allow) problem(`declares ${id}; drop its allow-list entry`);
    } else if (!(name in allow)) problem("declares no licence and has no allow-list entry");
    else if (!allow[name]?.trim()) problem("declares no licence; its allow-list entry gives no reason");
  }
  return problems;
}

/**
 * The packages `roots` pull in, by a lockfile's (v2 or v3) `packages`:
 * dependencies, optional and peer dependencies that are installed, each
 * resolved as Node does, from the nearest node_modules up. Dev-only
 * packages are never reached from a root's runtime dependencies.
 */
export function bundledPackages(lock, roots) {
  const entries = lock.packages ?? {};
  const resolve = (fromPath, name) => {
    let dir = fromPath;
    for (;;) {
      const candidate = `${dir ? `${dir}/` : ""}node_modules/${name}`;
      if (entries[candidate]) return candidate;
      if (!dir) return null;
      const index = dir.lastIndexOf("/node_modules/");
      dir = index === -1 ? "" : dir.slice(0, index);
    }
  };
  const seen = new Map();
  const visit = (at) => {
    if (seen.has(at)) return;
    const entry = entries[at];
    const name = entry.name ?? at.slice(at.lastIndexOf("node_modules/") + "node_modules/".length);
    seen.set(at, { name, version: entry.version, license: entry.license, path: at });
    const wanted = { ...entry.peerDependencies, ...entry.optionalDependencies, ...entry.dependencies };
    for (const dep of Object.keys(wanted)) {
      const found = resolve(at, dep);
      if (found) visit(found);
      else if (entry.dependencies?.[dep]) throw new Error(`${dep}, needed by ${name}, is not installed`);
    }
  };
  for (const root of roots) {
    const at = resolve("", root);
    if (!at) throw new Error(`${root} is not installed`);
    visit(at);
  }
  return [...seen.values()];
}
