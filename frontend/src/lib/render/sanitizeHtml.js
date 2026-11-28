// Offline, scriptless HTML preparation for <iframe sandbox="" srcdoc>.
// Defense in depth alongside the empty sandbox attribute and injected CSP:
// strips active elements/event handlers/dangerous schemes/external subresources,
// strips CSS @import and external url(...), injects strict CSP as the very
// first child of <head>, and counts blocked scripts and external resources.

export const OFFLINE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; frame-src 'none'; object-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none';";

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${OFFLINE_CSP}"><meta name="referrer" content="no-referrer">`;

// Active elements dropped completely (along with their inner content for container tags).
const STRIP_CONTAINER_TAGS = new Set(["script", "iframe", "object", "applet", "frameset"]);
const STRIP_VOID_OR_SELF_TAGS = new Set(["embed", "frame", "base"]);

// Attributes that carry subresource fetches if non-data:.
const RESOURCE_ATTRS = new Set(["src", "srcset", "poster", "background", "ping"]);
// Navigation / action attributes that must not hold javascript:/vbscript:/file:.
const NAV_URL_ATTRS = new Set(["href", "action", "formaction", "xlink:href", "data"]);

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(Math.min(code, 0x10ffff)) : "";
    })
    .replace(/&#([0-9]+);?/g, (_, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(Math.min(code, 0x10ffff)) : "";
    })
    .replace(/&colon;?/gi, ":")
    .replace(/&tab;?/gi, "\t")
    .replace(/&newline;?/gi, "\n");
}

function normalizedScheme(url) {
  // Strip ASCII control chars and whitespace before scheme inspection (HTML URL parser behavior).
  const cleaned = decodeEntities(url).replace(/[\u0000-\u0020]+/g, "").toLowerCase();
  const match = /^([a-z][a-z0-9+.-]*):/.exec(cleaned);
  return match ? match[1] : "";
}

function isDangerousScheme(url) {
  const scheme = normalizedScheme(url);
  return scheme === "javascript" || scheme === "vbscript" || scheme === "file";
}

function isDataUri(url) {
  return normalizedScheme(url) === "data";
}

function isExternalOrRelativeResource(url) {
  const trimmed = String(url ?? "").trim();
  if (!trimmed || trimmed.startsWith("#")) return false;
  return !isDataUri(trimmed);
}

/**
 * Strips CSS @import rules and replaces external/relative url(...) values with
 * url("about:invalid"), preserving data: URIs. Counts each blocked external CSS
 * import or url(...) reference.
 */
export function sanitizeCss(css) {
  let blockedResources = 0;
  let out = String(css ?? "");

  // Strip @import rules (terminated by ; or newline/EOF).
  out = out.replace(/@import\b[^;]*(?:;|$)/gi, () => {
    blockedResources += 1;
    return "/* blocked css rule */";
  });

  // Neutralize url(...) unless it is a data: URI or empty/fragment (#id).
  out = out.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s'"]*))\s*\)/gi, (match, dq, sq, bare) => {
    const raw = dq ?? sq ?? bare ?? "";
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#") || isDataUri(trimmed)) return match;
    blockedResources += 1;
    return 'url("about:invalid")';
  });

  // Neutralize legacy IE expression(...) / behavior:
  out = out.replace(/expression\s*\(/gi, "blocked(");

  return { css: out, blockedResources };
}

function escapeAttr(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// Parse attributes from the raw attribute substring of an opening tag.
function parseAttrs(raw) {
  const attrs = [];
  let i = 0;
  const len = raw.length;
  while (i < len) {
    while (i < len && /[\s/]/.test(raw[i])) i++;
    if (i >= len) break;
    const nameStart = i;
    while (i < len && !/[\s=/>]/.test(raw[i])) i++;
    const name = raw.slice(nameStart, i);
    if (!name) {
      i++;
      continue;
    }
    while (i < len && /\s/.test(raw[i])) i++;
    let hasValue = false;
    let value = "";
    if (i < len && raw[i] === "=") {
      hasValue = true;
      i++;
      while (i < len && /\s/.test(raw[i])) i++;
      if (i < len && (raw[i] === '"' || raw[i] === "'")) {
        const quote = raw[i++];
        const valStart = i;
        while (i < len && raw[i] !== quote) i++;
        value = raw.slice(valStart, i);
        if (i < len && raw[i] === quote) i++;
      } else {
        const valStart = i;
        while (i < len && !/[\s>]/.test(raw[i])) i++;
        value = raw.slice(valStart, i);
      }
    }
    attrs.push({ name, lower: name.toLowerCase(), hasValue, value });
  }
  return attrs;
}

// Find the end `>` of a tag starting at `<` (respecting quoted attribute values).
function findTagEnd(html, start) {
  let quote = "";
  for (let i = start + 1; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ">") return i;
  }
  return -1;
}

// Find matching closing tag `</tagName ...>` case-insensitively.
function findCloseTag(html, from, tagName) {
  const re = new RegExp(`</${tagName}\\b[^>]*>`, "gi");
  re.lastIndex = from;
  const match = re.exec(html);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}

function serializeTag(name, attrs, selfClosing) {
  const parts = [name];
  for (const attr of attrs) {
    if (attr.hasValue) parts.push(`${attr.name}="${escapeAttr(attr.value)}"`);
    else parts.push(attr.name);
  }
  return `<${parts.join(" ")}${selfClosing ? " /" : ""}>`;
}

function injectCspHead(html) {
  const headOpen = /<head\b[^>]*>/i.exec(html);
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length;
    return `${html.slice(0, at)}${CSP_META}${html.slice(at)}`;
  }
  const htmlOpen = /<html\b[^>]*>/i.exec(html);
  if (htmlOpen) {
    const at = htmlOpen.index + htmlOpen[0].length;
    return `${html.slice(0, at)}<head>${CSP_META}</head>${html.slice(at)}`;
  }
  const doctype = /^\s*<!doctype\b[^>]*>/i.exec(html);
  if (doctype) {
    const at = doctype.index + doctype[0].length;
    return `${html.slice(0, at)}<html><head>${CSP_META}</head>${html.slice(at)}</html>`;
  }
  return `<!doctype html><html><head>${CSP_META}</head><body>${html}</body></html>`;
}

// Secondary browser-DOM defense-in-depth check when DOMParser is available.
function hardenWithDomParser(html) {
  if (typeof DOMParser === "undefined") return html;
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const forbidden = doc.querySelectorAll("script, iframe, frame, frameset, object, embed, applet, base");
    for (const el of forbidden) el.remove();

    for (const meta of doc.querySelectorAll("meta[http-equiv]")) {
      const equiv = (meta.getAttribute("http-equiv") ?? "").trim().toLowerCase();
      if (equiv === "refresh" || equiv === "content-security-policy" || equiv === "set-cookie") {
        meta.remove();
      }
    }

    for (const link of doc.querySelectorAll("link")) {
      const href = link.getAttribute("href");
      if (href && isExternalOrRelativeResource(href)) link.remove();
    }

    for (const el of doc.querySelectorAll("*")) {
      for (const attr of [...el.attributes]) {
        const lower = attr.name.toLowerCase();
        if (lower.startsWith("on")) {
          el.removeAttribute(attr.name);
          continue;
        }
        if (RESOURCE_ATTRS.has(lower) && isExternalOrRelativeResource(attr.value)) {
          el.removeAttribute(attr.name);
          continue;
        }
        if (NAV_URL_ATTRS.has(lower) && isDangerousScheme(attr.value)) {
          el.removeAttribute(attr.name);
          continue;
        }
        if (lower === "style") {
          const { css } = sanitizeCss(attr.value);
          el.setAttribute("style", css);
        }
      }
    }

    for (const styleEl of doc.querySelectorAll("style")) {
      const { css } = sanitizeCss(styleEl.textContent ?? "");
      styleEl.textContent = css;
    }

    let head = doc.head;
    if (!head) {
      head = doc.createElement("head");
      doc.documentElement.insertBefore(head, doc.documentElement.firstChild);
    }
    const refMeta = doc.createElement("meta");
    refMeta.setAttribute("name", "referrer");
    refMeta.setAttribute("content", "no-referrer");
    head.insertBefore(refMeta, head.firstChild);

    const cspMeta = doc.createElement("meta");
    cspMeta.setAttribute("http-equiv", "Content-Security-Policy");
    cspMeta.setAttribute("content", OFFLINE_CSP);
    head.insertBefore(cspMeta, head.firstChild);

    return `<!doctype html>\n${doc.documentElement.outerHTML}`;
  } catch {
    return html;
  }
}

/**
 * Prepares untrusted HTML for offline, scriptless rendering inside
 * `<iframe sandbox="" referrerpolicy="no-referrer" srcdoc={...}>`.
 * Returns `{ srcdoc, blockedScripts, blockedResources }`.
 */
export function prepareOfflineHtml(html) {
  const input = String(html ?? "");
  let blockedScripts = 0;
  let blockedResources = 0;
  let out = "";
  let i = 0;

  while (i < input.length) {
    const lt = input.indexOf("<", i);
    if (lt < 0) {
      out += input.slice(i);
      break;
    }
    if (lt > i) out += input.slice(i, lt);

    // HTML comments
    if (input.startsWith("<!--", lt)) {
      const end = input.indexOf("-->", lt + 4);
      if (end < 0) {
        out += input.slice(lt);
        break;
      }
      out += input.slice(lt, end + 3);
      i = end + 3;
      continue;
    }

    // Doctype / declarations / processing instructions
    if (input[lt + 1] === "!" || input[lt + 1] === "?") {
      const gt = input.indexOf(">", lt + 2);
      if (gt < 0) {
        out += input.slice(lt);
        break;
      }
      out += input.slice(lt, gt + 1);
      i = gt + 1;
      continue;
    }

    const gt = findTagEnd(input, lt);
    if (gt < 0) {
      out += input.slice(lt);
      break;
    }

    const rawTag = input.slice(lt + 1, gt);
    const trimmedTag = rawTag.trim();
    if (!trimmedTag) {
      out += input.slice(lt, gt + 1);
      i = gt + 1;
      continue;
    }

    // Closing tag
    if (trimmedTag.startsWith("/")) {
      const closeName = trimmedTag.slice(1).trim().split(/\s+/)[0]?.toLowerCase() ?? "";
      if (!STRIP_CONTAINER_TAGS.has(closeName) && !STRIP_VOID_OR_SELF_TAGS.has(closeName)) {
        out += input.slice(lt, gt + 1);
      }
      i = gt + 1;
      continue;
    }

    const nameMatch = /^([a-zA-Z][a-zA-Z0-9:-]*)/.exec(trimmedTag);
    if (!nameMatch) {
      out += "<";
      i = lt + 1;
      continue;
    }

    const tagName = nameMatch[1];
    const lower = tagName.toLowerCase();
    const selfClosing = /\/\s*$/.test(trimmedTag);
    const rawAttrs = trimmedTag.slice(tagName.length, selfClosing ? trimmedTag.lastIndexOf("/") : undefined);
    const attrs = parseAttrs(rawAttrs);

    // Strip container active tags (script, iframe, object, applet, frameset)
    if (STRIP_CONTAINER_TAGS.has(lower)) {
      blockedScripts += 1;
      if (selfClosing) {
        i = gt + 1;
      } else {
        const close = findCloseTag(input, gt + 1, lower);
        i = close ? close.end : input.length;
      }
      continue;
    }

    // Strip void/self active tags (embed, frame, base)
    if (STRIP_VOID_OR_SELF_TAGS.has(lower)) {
      if (lower !== "base") blockedScripts += 1;
      i = gt + 1;
      continue;
    }

    // Strip <meta http-equiv="refresh" | "content-security-policy" | "set-cookie">
    if (lower === "meta") {
      const equiv = attrs.find((a) => a.lower === "http-equiv")?.value.trim().toLowerCase() ?? "";
      if (equiv === "refresh") {
        blockedScripts += 1;
        i = gt + 1;
        continue;
      }
      if (equiv === "content-security-policy" || equiv === "set-cookie") {
        i = gt + 1;
        continue;
      }
    }

    // Strip external <link href="..."> (stylesheets, preloads, icons, etc.)
    if (lower === "link") {
      const hrefAttr = attrs.find((a) => a.lower === "href");
      if (hrefAttr && isExternalOrRelativeResource(hrefAttr.value)) {
        blockedResources += 1;
        i = gt + 1;
        continue;
      }
    }

    // Sanitize attributes on kept tags
    const keptAttrs = [];
    for (const attr of attrs) {
      if (attr.lower.startsWith("on")) {
        blockedScripts += 1;
        continue;
      }
      if (RESOURCE_ATTRS.has(attr.lower)) {
        if (isDangerousScheme(attr.value)) {
          blockedScripts += 1;
          continue;
        }
        if (isExternalOrRelativeResource(attr.value)) {
          blockedResources += 1;
          continue;
        }
      }
      if (NAV_URL_ATTRS.has(attr.lower) && isDangerousScheme(attr.value)) {
        blockedScripts += 1;
        continue;
      }
      if (attr.lower === "style") {
        const cleaned = sanitizeCss(attr.value);
        blockedResources += cleaned.blockedResources;
        keptAttrs.push({ ...attr, value: cleaned.css });
        continue;
      }
      keptAttrs.push(attr);
    }

    // Handle <style>...</style>
    if (lower === "style" && !selfClosing) {
      const close = findCloseTag(input, gt + 1, "style");
      const cssBody = close ? input.slice(gt + 1, close.start) : input.slice(gt + 1);
      const cleaned = sanitizeCss(cssBody);
      blockedResources += cleaned.blockedResources;
      out += `${serializeTag(tagName, keptAttrs, false)}${cleaned.css}</style>`;
      i = close ? close.end : input.length;
      continue;
    }

    out += serializeTag(tagName, keptAttrs, selfClosing);
    i = gt + 1;
  }

  const withCsp = injectCspHead(out);
  const srcdoc = hardenWithDomParser(withCsp);
  return { srcdoc, blockedScripts, blockedResources };
}
