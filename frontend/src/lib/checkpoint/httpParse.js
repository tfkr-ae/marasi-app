// The Checkpoint editor's malformed warning: why Marasi won't forward an
// edited request or response, in the words of the error its rebuild returns
// (the service refuses the forward with it, after "cannot rebuild request: "
// or "cannot rebuild response: "). "" when the edit would forward.
//
// A port of what Marasi 05b209c runs on a Checkpoint forward. An HTTP/1.1
// item is read by its own codec: h1engine_checkpoint.go rebuildWireRequest
// and rebuildWireResponse, internal/h1 ReadRequestHead and ReadResponseHead
// (head.go, header.go readFields), then RequestHead.Request (view.go
// parseTarget, url.ParseRequestURI). An HTTP/2 item is read in its text form:
// h2engine_text.go readH2RequestText and readH2ResponseText, url.Parse for an
// absolute-form target. The url and netip parts port Go 1.26.
//
// Only the head is read, never the body. It works on the text's UTF-8 bytes,
// held one per char in a "byte string", as Go does.
// httpParse.cases.json records Marasi's answers
// (scripts/record-checkpoint-parse-cases.sh).

/**
 * Why `text` won't forward as the edit of a held `type` ("request" or
 * "response") item of `protocol` ("http/1.1" or "h2"), or "".
 */
export function httpParseError(text, type, protocol = "http/1.1") {
  if (type !== "request" && type !== "response") return "";
  try {
    if (protocol === "h2") readH2Text(text ?? "", type);
    else if (type === "request") readH1Request(text ?? "");
    else readH1Response(text ?? "");
    return "";
  } catch (err) {
    if (err instanceof ParseError) return err.message;
    throw err;
  }
}

/**
 * The protocol of a held HTTP item, from its raw text as held: Marasi shows
 * an HTTP/2 request as `METHOD target HTTP/2` and an HTTP/2 response as
 * `HTTP/2 <status>`.
 */
export function heldProtocol(raw, type) {
  const text = raw ?? "";
  const nl = text.indexOf("\n");
  const line = (nl < 0 ? text : text.slice(0, nl)).replace(/\r$/, "");
  if (type === "request" && line.endsWith(" HTTP/2")) return "h2";
  if (type === "response" && line.startsWith("HTTP/2 ")) return "h2";
  return "http/1.1";
}

class ParseError extends Error {}

const fail = (message) => {
  throw new ParseError(message);
};

function toBytes(text) {
  const bytes = new TextEncoder().encode(text);
  let out = "";
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return out;
}

function cut(s, sep) {
  const at = s.indexOf(sep);
  return at < 0 ? [s, "", false] : [s.slice(0, at), s.slice(at + sep.length), true];
}

const isAlnum = (c) => (c >= "0" && c <= "9") || (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");

// --- internal/h1 -----------------------------------------------------------

// h1.MaxHeadBytes: the start line and the header section.
const MAX_HEAD_BYTES = 1 << 20;
const MALFORMED = "malformed message head";
const TCHARS = "!#$%&'*+-.^_`|~";
const isToken = (s) => s.length > 0 && [...s].every((c) => isAlnum(c) || TCHARS.includes(c));

// The text up to the empty line that ends the head, and at most one byte
// past MaxHeadBytes: the codec reads no further.
function h1Head(text, type) {
  let pos = 0;
  const lineEnd = (at) => {
    const nl = text.indexOf("\n", at);
    return nl < 0 ? text.length : nl + 1;
  };
  const emptyAt = (at) => (text.startsWith("\n", at) ? 1 : text.startsWith("\r\n", at) ? 2 : 0);
  // A request may follow empty lines; a response's first line is its status line.
  if (type === "request") while (pos <= MAX_HEAD_BYTES && emptyAt(pos)) pos += emptyAt(pos);
  pos = lineEnd(pos);
  while (pos < text.length && pos <= MAX_HEAD_BYTES && !emptyAt(pos)) pos = lineEnd(pos);
  pos += emptyAt(pos);
  return toBytes(text.slice(0, Math.min(pos, MAX_HEAD_BYTES + 1)));
}

// readLine over the bytes: each line with its LF, and whether the input
// ended before one. Past MaxHeadBytes in all, ErrHeadTooLarge.
function h1Lines(s, prefix) {
  let pos = 0;
  return () => {
    const nl = s.indexOf("\n", pos);
    const end = nl < 0 ? s.length : nl + 1;
    if (end > MAX_HEAD_BYTES) fail(`${prefix}message head too large`);
    const line = s.slice(pos, end);
    pos = end;
    return { line, eof: nl < 0 };
  };
}

// Without a trailing LF or CRLF.
function trimEOL(line) {
  const lf = line.endsWith("\n") ? line.slice(0, -1) : line;
  return lf.endsWith("\r") ? lf.slice(0, -1) : lf;
}
const validProto = (p) => p.length === 8 && p.startsWith("HTTP/1.") && p[7] >= "0" && p[7] <= "9";
// No CR, LF or NUL (RFC 9110 §5.5).
const validValue = (v) => !/[\r\n\0]/.test(v);

function parseRequestLine(line) {
  const [m, rest, ok1] = cut(line, " ");
  const [t, p, ok2] = cut(rest, " ");
  if (!ok1 || !ok2 || !m || !t || !isToken(m) || !validProto(p)) return null;
  if ([...t].some((c) => c <= " " || c === "\x7f")) return null;
  return { method: m, target: t };
}

// A request line well formed but for a version HTTP/DIGIT.DIGIT whose major
// version isn't 1. The HTTP/2 preface is not one.
function otherMajorVersion(line) {
  if (line === "PRI * HTTP/2.0") return false;
  const i = line.lastIndexOf(" ");
  if (i < 0) return false;
  const p = line.slice(i + 1);
  const digit = (c) => c >= "0" && c <= "9";
  if (p.length !== 8 || !p.startsWith("HTTP/") || p[6] !== "." || !digit(p[5]) || !digit(p[7]) || p[5] === "1") {
    return false;
  }
  return parseRequestLine(`${line.slice(0, i + 1)}HTTP/1.1`) !== null;
}

// readFields: the field lines up to the empty line, each a token name, a
// colon and a value, or an obsolete fold of the field above.
function readFields(next, prefix) {
  let fields = 0;
  for (;;) {
    const { line, eof } = next();
    if (eof) fail(`${prefix}unexpected EOF`);
    const content = trimEOL(line);
    if (content === "") return;
    const bad = (why = "") => fail(`${prefix}parsing field line ${quote(content)}: ${why}${MALFORMED}`);
    if (content[0] === " " || content[0] === "\t") {
      if (!fields) bad("continuation without a field: ");
      if (!validValue(content)) bad();
      continue;
    }
    const [name, value, ok] = cut(content, ":");
    if (!ok || !isToken(name) || !validValue(value)) bad();
    fields++;
  }
}

function readH1Request(text) {
  const prefix = "reading the edited request head: ";
  const next = h1Lines(h1Head(text, "request"), prefix);
  let line;
  for (let first = true; ; first = false) {
    const read = next();
    if (read.eof) fail(`${prefix}${first ? "EOF" : "unexpected EOF"}`);
    line = trimEOL(read.line);
    if (line !== "") break;
  }
  const parsed = parseRequestLine(line);
  if (!parsed) {
    const why = otherMajorVersion(line) ? "unsupported HTTP major version: " : "";
    fail(`${prefix}parsing request line ${quote(line)}: ${why}${MALFORMED}`);
  }
  readFields(next, prefix);
  // RequestHead.Request: parseTarget.
  const { method, target } = parsed;
  if ((method === "CONNECT" && !target.startsWith("/")) || target === "*") return;
  const error = parseURL(target, true).error;
  if (error) {
    fail(`reading the edited request: parsing request target ${quote(target)}: parse ${quote(target)}: ${error}`);
  }
}

function readH1Response(text) {
  const prefix = "reading the edited response head: ";
  const next = h1Lines(h1Head(text, "response"), prefix);
  const { line: raw, eof } = next();
  if (eof) fail(`${prefix}${raw === "" ? "EOF" : "unexpected EOF"}`);
  const line = trimEOL(raw);
  const [p, rest] = cut(line, " ");
  const [code, reason] = cut(rest, " ");
  if (!validProto(p) || !/^[0-9]{3}$/.test(code) || Number(code) < 100 || /[\r\0]/.test(reason)) {
    fail(`${prefix}parsing status line ${quote(line)}: ${MALFORMED}`);
  }
  readFields(next, prefix);
}

// --- h2engine_text.go ------------------------------------------------------

const H2_TEXT = "not an HTTP/2 message in the text form";
const trimCR = (line) => (line.endsWith("\r") ? line.slice(0, -1) : line);

// readH2RequestText and readH2ResponseText: a start line, then
// "name: value" lines up to the first blank line (CRLF or LF). The name is
// everything before the first colon after its first character, so a
// pseudo-header field reads as itself; nothing else in a field is checked.
// Text with no blank line is all head. These checks are ASCII, so they run
// on the text itself; only a quote or a URL needs its bytes.
function readH2Text(text, type) {
  const crlf = text.indexOf("\r\n\r\n");
  const lf = text.indexOf("\n\n");
  const end = lf >= 0 && (crlf < 0 || lf < crlf) ? lf : crlf;
  const head = end >= 0 ? text.slice(0, end) : text;
  const [first, rest] = cut(head, "\n");
  const line = trimCR(first);
  let target = null;
  if (type === "request") {
    const [, after, ok] = cut(line, " ");
    const i = after.lastIndexOf(" ");
    if (!ok || i < 0 || after.slice(i + 1) !== "HTTP/2") {
      fail(`${H2_TEXT}: the request line ${quote(toBytes(line))} is not METHOD target HTTP/2`);
    }
    target = after.slice(0, i);
  } else if (cut(line, " ")[0] !== "HTTP/2") {
    fail(`${H2_TEXT}: the status line ${quote(toBytes(line))} is not HTTP/2 <status>`);
  }
  for (const raw of rest.split("\n")) {
    const field = trimCR(raw);
    if (field !== "" && !field.slice(1).includes(":")) {
      fail(`${H2_TEXT}: the field line ${quote(toBytes(field))} has no colon`);
    }
  }
  // An absolute-form target names where the request goes, so it must parse
  // and have a host.
  if (target !== null && !target.startsWith("/") && target !== "*" && target.includes("://")) {
    const bytes = toBytes(target);
    const url = parseURLWithFragment(bytes);
    if (url.error || !url.host) fail(`${H2_TEXT}: the request target ${quote(bytes)}`);
  }
}

// --- strconv.Quote ---------------------------------------------------------

const ESCAPES = { 7: "\\a", 8: "\\b", 12: "\\f", 10: "\\n", 13: "\\r", 9: "\\t", 11: "\\v", 34: '\\"', 92: "\\\\" };
const hex = (n, width) => n.toString(16).padStart(width, "0");
const PRINTABLE = /^[\p{L}\p{M}\p{N}\p{P}\p{S}]$/u;

// The UTF-8 rune at `i` as [codePoint, size], or null for an invalid byte.
function runeAt(s, i) {
  const c = s.charCodeAt(i);
  const cont = (j, lo = 0x80, hi = 0xbf) => {
    const b = s.charCodeAt(i + j);
    return b >= lo && b <= hi ? b & 0x3f : -1;
  };
  if (c >= 0xc2 && c <= 0xdf) {
    const b1 = cont(1);
    return b1 < 0 ? null : [((c & 0x1f) << 6) | b1, 2];
  }
  if (c >= 0xe0 && c <= 0xef) {
    const b1 = cont(1, c === 0xe0 ? 0xa0 : 0x80, c === 0xed ? 0x9f : 0xbf);
    const b2 = cont(2);
    return b1 < 0 || b2 < 0 ? null : [((c & 0x0f) << 12) | (b1 << 6) | b2, 3];
  }
  if (c >= 0xf0 && c <= 0xf4) {
    const b1 = cont(1, c === 0xf0 ? 0x90 : 0x80, c === 0xf4 ? 0x8f : 0xbf);
    const b2 = cont(2);
    const b3 = cont(3);
    return b1 < 0 || b2 < 0 || b3 < 0 ? null : [((c & 0x07) << 18) | (b1 << 12) | (b2 << 6) | b3, 4];
  }
  return null;
}

/** Go's strconv.Quote (and %q) of the bytes. */
function quote(s) {
  let out = '"';
  for (let i = 0; i < s.length; ) {
    const c = s.charCodeAt(i);
    if (c < 0x80) {
      if (ESCAPES[c]) out += ESCAPES[c];
      else if (c < 0x20 || c === 0x7f) out += `\\x${hex(c, 2)}`;
      else out += s[i];
      i++;
      continue;
    }
    const rune = runeAt(s, i);
    if (!rune) {
      out += `\\x${hex(c, 2)}`;
      i++;
      continue;
    }
    const [code, size] = rune;
    const char = String.fromCodePoint(code);
    if (PRINTABLE.test(char)) out += char;
    else out += code < 0x10000 ? `\\u${hex(code, 4)}` : `\\U${hex(code, 8)}`;
    i += size;
  }
  return `${out}"`;
}

// --- net/url ---------------------------------------------------------------

// url.Parse: { error } or { host }.
function parseURLWithFragment(raw) {
  const [u, frag] = cut(raw, "#");
  const url = parseURL(u, false);
  if (url.error || frag === "") return url;
  const fragment = unescape(frag, "fragment");
  return fragment.error ? fragment : url;
}

// url's parse, as ParseRequestURI (viaRequest) or Parse runs it: { error }
// or { host }.
function parseURL(raw, viaRequest) {
  if ([...raw].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)) {
    return { error: "net/url: invalid control character in URL" };
  }
  if (raw === "" && viaRequest) return { error: "empty url" };
  if (raw === "*") return { host: "" };
  const scheme = getScheme(raw);
  if (scheme.error) return scheme;
  let rest = scheme.rest;
  if (rest.endsWith("?") && rest.split("?").length === 2) rest = rest.slice(0, -1);
  else [rest] = cut(rest, "?");
  if (!rest.startsWith("/")) {
    if (scheme.name) return { host: "" };
    if (viaRequest) return { error: "invalid URI for request" };
    if (cut(rest, "/")[0].includes(":")) return { error: "first path segment in URL cannot contain colon" };
  }
  let host = "";
  if ((scheme.name || (!viaRequest && !rest.startsWith("///"))) && rest.startsWith("//")) {
    let authority = rest.slice(2);
    const slash = authority.indexOf("/");
    rest = slash >= 0 ? authority.slice(slash) : "";
    if (slash >= 0) authority = authority.slice(0, slash);
    const parsed = parseAuthority(scheme.name.toLowerCase(), authority);
    if (parsed.error) return parsed;
    host = parsed.host;
  }
  const path = unescape(rest, "path");
  return path.error ? path : { host };
}

function getScheme(raw) {
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z")) continue;
    if ((c >= "0" && c <= "9") || c === "+" || c === "-" || c === ".") {
      if (i === 0) return { name: "", rest: raw };
      continue;
    }
    if (c === ":") {
      if (i === 0) return { error: "missing protocol scheme" };
      return { name: raw.slice(0, i), rest: raw.slice(i + 1) };
    }
    return { name: "", rest: raw };
  }
  return { name: "", rest: raw };
}

const isHex = (c) => /^[0-9a-fA-F]$/.test(c ?? "");
const HOST_ALLOWED = "!$&'()*+,;=:[]<>\"-_.~";
// url's shouldEscape for the host and zone modes.
const hostEscapes = (c) => !(isAlnum(c) || HOST_ALLOWED.includes(c));

// url's unescape: { value } or { error }.
function unescape(s, mode) {
  let out = "";
  for (let i = 0; i < s.length; ) {
    const c = s[i];
    if (c === "%") {
      if (i + 2 >= s.length || !isHex(s[i + 1]) || !isHex(s[i + 2])) {
        return { error: `invalid URL escape ${quote(s.slice(i, i + 3))}` };
      }
      const escape = s.slice(i, i + 3);
      const value = parseInt(s.slice(i + 1, i + 3), 16);
      if (mode === "host" && value >> 4 < 8 && escape !== "%25") {
        return { error: `invalid URL escape ${quote(escape)}` };
      }
      if (mode === "zone") {
        const byte = String.fromCharCode(value);
        if (escape !== "%25" && byte !== " " && hostEscapes(byte)) {
          return { error: `invalid URL escape ${quote(escape)}` };
        }
      }
      out += String.fromCharCode(value);
      i += 3;
      continue;
    }
    if ((mode === "host" || mode === "zone") && c.charCodeAt(0) < 0x80 && hostEscapes(c)) {
      return { error: `invalid character ${quote(c)} in host name` };
    }
    out += c;
    i++;
  }
  return { value: out };
}

const USERINFO = "-._:~!$&'()*+,;=%@";

// { error } or { host }.
function parseAuthority(scheme, authority) {
  const at = authority.lastIndexOf("@");
  const host = parseHost(scheme, at < 0 ? authority : authority.slice(at + 1));
  if (host.error || at < 0) return host;
  const userinfo = authority.slice(0, at);
  if (![...userinfo].every((c) => isAlnum(c) || USERINFO.includes(c))) return { error: "net/url: invalid userinfo" };
  const parts = userinfo.includes(":") ? cut(userinfo, ":").slice(0, 2) : [userinfo];
  for (const part of parts) {
    const { error } = unescape(part, "userinfo");
    if (error) return { error };
  }
  return host;
}

const validOptionalPort = (port) => port === "" || /^:[0-9]*$/.test(port);

// { error } or { host }, the host as unescaped: empty only when `host` is.
function parseHost(scheme, host) {
  const open = host.lastIndexOf("[");
  if (open !== -1) {
    const close = host.lastIndexOf("]");
    if (close < 0) return { error: "missing ']' in host" };
    const colonPort = host.slice(close + 1);
    if (!validOptionalPort(colonPort)) return { error: `invalid port ${quote(colonPort)} after host` };
    const port = unescape(colonPort, "host");
    if (port.error) return port;
    const hostname = host.slice(open + 1, close);
    const zoneAt = hostname.indexOf("%25");
    let unescaped;
    if (zoneAt >= 0) {
      const hostPart = unescape(hostname.slice(0, zoneAt), "host");
      if (hostPart.error) return hostPart;
      const zonePart = unescape(hostname.slice(zoneAt), "zone");
      if (zonePart.error) return zonePart;
      unescaped = hostPart.value + zonePart.value;
    } else {
      const all = unescape(hostname, "host");
      if (all.error) return all;
      unescaped = all.value;
    }
    const addr = parseAddr(unescaped);
    if (addr.error) return { error: `invalid host: ${addr.error}` };
    if (addr.is4) return { error: "invalid IP-literal" };
    return { host: `[${unescaped}]${port.value}` };
  }
  const colon = host.indexOf(":");
  if (colon !== -1) {
    const last = host.lastIndexOf(":");
    const at = last !== colon && (scheme === "postgresql" || scheme === "postgres") ? last : colon;
    const colonPort = host.slice(at);
    if (!validOptionalPort(colonPort)) return { error: `invalid port ${quote(colonPort)} after host` };
  }
  const unescaped = unescape(host, "host");
  return unescaped.error ? unescaped : { host: unescaped.value };
}

// --- net/netip -------------------------------------------------------------

// netip.ParseAddr: { is4 } or { error }.
function parseAddr(s) {
  for (const c of s) {
    if (c === ".") return parseIPv4(s);
    if (c === ":") return parseIPv6(s);
    if (c === "%") return addrError(s, "missing IPv6 address");
  }
  return addrError(s, "unable to parse IP");
}

function addrError(input, msg, at = "") {
  return { error: `ParseAddr(${quote(input)}): ${msg}${at ? ` (at ${quote(at)})` : ""}` };
}

// The IPv4 fields of input[off:end]: { error } or {}.
function ipv4Fields(input, off, end) {
  const s = input.slice(off, end);
  let val = 0;
  let pos = 0;
  let digits = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c >= "0" && c <= "9") {
      if (digits === 1 && val === 0) return addrError(input, "IPv4 field has octet with leading zero");
      val = val * 10 + Number(c);
      digits++;
      if (val > 255) return addrError(input, "IPv4 field has value >255");
    } else if (c === ".") {
      if (i === 0 || i === s.length - 1 || s[i - 1] === ".") {
        return addrError(input, "IPv4 field must have at least one digit", s.slice(i));
      }
      if (pos === 3) return addrError(input, "IPv4 address too long");
      pos++;
      val = 0;
      digits = 0;
    } else {
      return addrError(input, "unexpected character", s.slice(i));
    }
  }
  if (pos < 3) return addrError(input, "IPv4 address too short");
  return {};
}

function parseIPv4(s) {
  const fields = ipv4Fields(s, 0, s.length);
  return fields.error ? fields : { is4: true };
}

function parseIPv6(input) {
  let s = input;
  let zone = "";
  const percent = s.indexOf("%");
  if (percent !== -1) {
    [s, zone] = [s.slice(0, percent), s.slice(percent + 1)];
    if (zone === "") return addrError(input, "zone must be a non-empty string");
  }
  let ellipsis = -1;
  if (s.length >= 2 && s[0] === ":" && s[1] === ":") {
    ellipsis = 0;
    s = s.slice(2);
    if (s.length === 0) return { is4: false };
  }
  let i = 0;
  while (i < 16) {
    let off = 0;
    let acc = 0;
    for (; off < s.length; off++) {
      if (!isHex(s[off])) break;
      acc = acc * 16 + parseInt(s[off], 16);
      if (off > 3) return addrError(input, "each group must have 4 or less digits", s);
      if (acc > 0xffff) return addrError(input, "IPv6 field has value >=2^16", s);
    }
    if (off === 0) return addrError(input, "each colon-separated field must have at least one digit", s);
    if (off < s.length && s[off] === ".") {
      if (ellipsis < 0 && i !== 12) {
        return addrError(input, "embedded IPv4 address must replace the final 2 fields of the address", s);
      }
      if (i + 4 > 16) {
        return addrError(input, "too many hex fields to fit an embedded IPv4 at the end of the address", s);
      }
      const end = input.length - (zone.length ? zone.length + 1 : 0);
      const fields = ipv4Fields(input, end - s.length, end);
      if (fields.error) return fields;
      s = "";
      i += 4;
      break;
    }
    i += 2;
    s = s.slice(off);
    if (s.length === 0) break;
    if (s[0] !== ":") return addrError(input, "unexpected character, want colon", s);
    if (s.length === 1) return addrError(input, "colon must be followed by more characters", s);
    s = s.slice(1);
    if (s[0] === ":") {
      if (ellipsis >= 0) return addrError(input, "multiple :: in address", s);
      ellipsis = i;
      s = s.slice(1);
      if (s.length === 0) break;
    }
  }
  if (s.length !== 0) return addrError(input, "trailing garbage after address", s);
  if (i < 16) {
    if (ellipsis < 0) return addrError(input, "address string too short");
  } else if (ellipsis >= 0) {
    return addrError(input, "the :: must expand to at least one field of zeros");
  }
  return { is4: false };
}
