// The Checkpoint editor's malformed warning: why an edited request or
// response won't be read as HTTP, in the words Go's net/http uses
// (http.ReadRequest and http.ReadResponse, which the app's Go side ran
// before, and which Marasi runs on Forward). "" when the text parses.
//
// A port of the parts of net/http, net/textproto, net/url and net/netip
// (Go 1.26) those two calls run. They read the start line and the headers,
// never the body. It works on the text's UTF-8 bytes, held one per char in
// a "byte string", as Go does; httpParse.cases.json records Go's answers.

/** Why `text` doesn't parse as an HTTP `type` ("request" or "response"), or "". */
export function httpParseError(text, type) {
  if (type !== "request" && type !== "response") return "";
  const reader = lineReader(toBytes(head(text ?? "")));
  try {
    if (type === "request") readRequest(reader);
    else readResponse(reader);
    return "";
  } catch (err) {
    if (err instanceof ParseError) return err.message;
    throw err;
  }
}

class ParseError extends Error {}

const fail = (message) => {
  throw new ParseError(message);
};

const EOF = "EOF";
const UNEXPECTED_EOF = "unexpected EOF";

// The text up to the blank line after the headers: nothing after it is read.
function head(text) {
  const end = /\n\r?\n/.exec(text);
  return end ? text.slice(0, end.index + end[0].length) : text;
}

function toBytes(text) {
  const bytes = new TextEncoder().encode(text);
  let out = "";
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return out;
}

const fromBytes = (bytes) => new TextDecoder().decode(Uint8Array.from(bytes, (c) => c.charCodeAt(0)));

// bufio.Reader.ReadLine over the bytes: each line without its "\n" or
// "\r\n" (a "\r" at the very end stays), then null at the end.
function lineReader(s) {
  let pos = 0;
  return {
    readLine() {
      if (pos >= s.length) return null;
      const nl = s.indexOf("\n", pos);
      if (nl < 0) {
        const line = s.slice(pos);
        pos = s.length;
        return line;
      }
      const line = s.slice(pos, nl);
      pos = nl + 1;
      return line.endsWith("\r") ? line.slice(0, -1) : line;
    },
    peek: () => s[pos],
    skipSpace() {
      let n = 0;
      while (s[pos] === " " || s[pos] === "\t") {
        pos++;
        n++;
      }
      return n;
    },
  };
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

// %q of a []string: ["a" "b"].
const quoteList = (list) => `[${list.map(quote).join(" ")}]`;

// --- net/http --------------------------------------------------------------

const TCHARS = "!#$%&'*+-.^_`|~";
const isAlnum = (c) => (c >= "0" && c <= "9") || (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
const isTchar = (c) => isAlnum(c) || TCHARS.includes(c);
const isToken = (s) => s.length > 0 && [...s].every(isTchar);

function cut(s, sep) {
  const at = s.indexOf(sep);
  return at < 0 ? [s, "", false] : [s.slice(0, at), s.slice(at + sep.length), true];
}

// http.ParseHTTPVersion: [major, minor], or null.
function parseVersion(v) {
  if (v === "HTTP/1.1") return [1, 1];
  if (v === "HTTP/1.0") return [1, 0];
  if (!v.startsWith("HTTP/") || v.length !== 8 || v[6] !== ".") return null;
  const digit = (c) => (c >= "0" && c <= "9" ? Number(c) : null);
  const major = digit(v[5]);
  const minor = digit(v[7]);
  return major === null || minor === null ? null : [major, minor];
}

function readRequest(reader) {
  const line = reader.readLine();
  if (line === null) fail(EOF);
  const [method, rest, ok1] = cut(line, " ");
  const [uri, proto, ok2] = cut(rest, " ");
  if (!ok1 || !ok2) fail(`malformed HTTP request ${quote(line)}`);
  if (!isToken(method)) fail(`invalid method ${quote(method)}`);
  const version = parseVersion(proto);
  if (!version) fail(`malformed HTTP version ${quote(proto)}`);
  const raw = method === "CONNECT" && !uri.startsWith("/") ? `http://${uri}` : uri;
  const urlError = parseRequestURI(raw);
  if (urlError) fail(`parse ${quote(raw)}: ${urlError}`);
  const header = readMIMEHeader(reader);
  if ((header.get("Host") ?? []).length > 1) fail("too many Host headers");
  readTransfer(header, version);
}

function readResponse(reader) {
  const line = reader.readLine();
  if (line === null) fail(UNEXPECTED_EOF);
  const [proto, rest, ok] = cut(line, " ");
  if (!ok) fail(`malformed HTTP response ${quote(line)}`);
  const status = rest.replace(/^ +/, "");
  const [code] = cut(status, " ");
  if (code.length !== 3 || !/^[+-]?[0-9]+$/.test(code) || Number(code) < 0) {
    fail(`malformed HTTP status code ${quote(code)}`);
  }
  const version = parseVersion(proto);
  if (!version) fail(`malformed HTTP version ${quote(proto)}`);
  const header = readMIMEHeader(reader);
  readTransfer(header, version);
}

// textproto.TrimString: without leading and trailing ASCII space.
const trimString = (s) => s.replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, "");

// http.readTransfer's checks: the body itself is never read.
function readTransfer(header, [major, minor]) {
  if (major === 0 && minor === 0) [major, minor] = [1, 1];
  // parseTransferEncoding
  let chunked = false;
  const encodings = header.get("Transfer-Encoding");
  if (encodings) {
    header.delete("Transfer-Encoding");
    if (major > 1 || (major === 1 && minor >= 1)) {
      if (encodings.length !== 1) fail(`too many transfer encodings: ${quoteList(encodings)}`);
      if (encodings[0].toLowerCase() !== "chunked" || encodings[0].length !== 7) {
        fail(`unsupported transfer encoding: ${quote(encodings[0])}`);
      }
      chunked = true;
    }
  }
  // fixLength
  const lengths = header.get("Content-Length") ?? [];
  if (lengths.length > 1) {
    const first = trimString(lengths[0]);
    if (lengths.slice(1).some((l) => trimString(l) !== first)) {
      fail(`http: message cannot contain multiple Content-Length headers; got ${quoteList(lengths)}`);
    }
  }
  if (lengths.length) {
    const length = trimString(lengths[0]);
    if (length === "") fail(`invalid empty Content-Length ${quote(length)}`);
    if (!/^[0-9]+$/.test(length) || BigInt(length) > 2n ** 63n - 1n) fail(`bad Content-Length ${quote(length)}`);
  }
  // fixTrailer
  const trailers = header.get("Trailer");
  if (!trailers || !chunked) return;
  for (const value of trailers) {
    for (const element of value.split(",")) {
      const key = canonicalKey(trimString(element));
      if (key === "") continue;
      if (key === "Transfer-Encoding" || key === "Trailer" || key === "Content-Length") {
        fail(`bad trailer key ${quote(key)}`);
      }
    }
  }
}

// --- net/textproto ---------------------------------------------------------

// The key with its first letter and each letter after "-" upper case, the
// rest lower case; unchanged when it holds a byte a key can't.
function canonicalKey(key) {
  if (![...key].every(isTchar)) return key;
  let upper = true;
  let out = "";
  for (const c of key) {
    out += upper ? c.toUpperCase() : c.toLowerCase();
    upper = c === "-";
  }
  return out;
}

const validValueByte = (c) => {
  const b = c.charCodeAt(0);
  return b === 0x09 || (b >= 0x20 && b <= 0x7e) || b >= 0x80;
};
const trimSpaceTab = (s) => s.replace(/^[ \t]+|[ \t]+$/g, "");

// The header as a Map of key to values. The end of the text before the
// blank line is an "unexpected EOF".
function readMIMEHeader(reader) {
  const header = new Map();
  const first = reader.peek();
  if (first === " " || first === "\t") {
    const line = reader.readLine();
    if (line.length > 80) fail("message too large");
    fail(`malformed MIME header initial line: ${fromBytes(line)}`);
  }
  for (;;) {
    const line = reader.readLine();
    if (line === null) fail(UNEXPECTED_EOF);
    if (line === "") return header;
    if (!line.includes(":")) fail(`malformed MIME header: missing colon: ${quote(line)}`);
    // Lines starting with a space or tab continue this one.
    let kv = trimSpaceTab(line);
    while (reader.skipSpace() > 0) {
      kv += " ";
      const more = reader.readLine();
      if (more === null) break;
      kv += trimSpaceTab(more);
    }
    const [k, v] = cut(kv, ":");
    const malformed = () => fail(`malformed MIME header line: ${fromBytes(kv)}`);
    if (k === "" || ![...k].every((c) => isTchar(c) || c === " ")) malformed();
    if (![...v].every(validValueByte)) malformed();
    // A key with a space is kept as it is.
    const key = k.includes(" ") ? k : canonicalKey(k);
    if (!header.has(key)) header.set(key, []);
    header.get(key).push(v.replace(/^[ \t]+/, ""));
  }
}

// --- net/url ---------------------------------------------------------------

// url.ParseRequestURI's error, or "".
function parseRequestURI(raw) {
  if ([...raw].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)) {
    return "net/url: invalid control character in URL";
  }
  if (raw === "") return "empty url";
  if (raw === "*") return "";
  const scheme = getScheme(raw);
  if (scheme.error) return scheme.error;
  let rest = scheme.rest;
  if (rest.endsWith("?") && rest.split("?").length === 2) rest = rest.slice(0, -1);
  else [rest] = cut(rest, "?");
  if (!rest.startsWith("/")) return scheme.name ? "" : "invalid URI for request";
  if (scheme.name && rest.startsWith("//")) {
    let authority = rest.slice(2);
    const slash = authority.indexOf("/");
    rest = slash >= 0 ? authority.slice(slash) : "";
    if (slash >= 0) authority = authority.slice(0, slash);
    const error = parseAuthority(scheme.name.toLowerCase(), authority);
    if (error) return error;
  }
  return unescape(rest, "path").error ?? "";
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

function parseAuthority(scheme, authority) {
  const at = authority.lastIndexOf("@");
  const hostError = parseHost(scheme, at < 0 ? authority : authority.slice(at + 1));
  if (hostError) return hostError;
  if (at < 0) return "";
  const userinfo = authority.slice(0, at);
  if (![...userinfo].every((c) => isAlnum(c) || USERINFO.includes(c))) return "net/url: invalid userinfo";
  const parts = userinfo.includes(":") ? cut(userinfo, ":").slice(0, 2) : [userinfo];
  for (const part of parts) {
    const { error } = unescape(part, "userinfo");
    if (error) return error;
  }
  return "";
}

const validOptionalPort = (port) => port === "" || /^:[0-9]*$/.test(port);

function parseHost(scheme, host) {
  const open = host.lastIndexOf("[");
  if (open !== -1) {
    const close = host.lastIndexOf("]");
    if (close < 0) return "missing ']' in host";
    const colonPort = host.slice(close + 1);
    if (!validOptionalPort(colonPort)) return `invalid port ${quote(colonPort)} after host`;
    const port = unescape(colonPort, "host");
    if (port.error) return port.error;
    const hostname = host.slice(open + 1, close);
    const zoneAt = hostname.indexOf("%25");
    let unescaped;
    if (zoneAt >= 0) {
      const hostPart = unescape(hostname.slice(0, zoneAt), "host");
      if (hostPart.error) return hostPart.error;
      const zonePart = unescape(hostname.slice(zoneAt), "zone");
      if (zonePart.error) return zonePart.error;
      unescaped = hostPart.value + zonePart.value;
    } else {
      const all = unescape(hostname, "host");
      if (all.error) return all.error;
      unescaped = all.value;
    }
    const addr = parseAddr(unescaped);
    if (addr.error) return `invalid host: ${addr.error}`;
    if (addr.is4) return "invalid IP-literal";
    return "";
  }
  const colon = host.indexOf(":");
  if (colon !== -1) {
    const last = host.lastIndexOf(":");
    const at = last !== colon && (scheme === "postgresql" || scheme === "postgres") ? last : colon;
    const colonPort = host.slice(at);
    if (!validOptionalPort(colonPort)) return `invalid port ${quote(colonPort)} after host`;
  }
  return unescape(host, "host").error ?? "";
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
