// The Checkpoint edit check v1's Go side ran (CheckHTTPParse): an edited
// request or response is read as Go's http.ReadRequest or http.ReadResponse
// would, with the same error text. Marasi refuses an unparsable forward with
// a bare invalid_checkpoint_request, so the message comes from here. Only the
// head is read, as Go reads it: the request line or status line, the header
// and the framing headers (Content-Length, Transfer-Encoding, Trailer).

// Go's %q of a string.
function quote(text) {
  const named = { '"': '\\"', "\\": "\\\\", "\n": "\\n", "\r": "\\r", "\t": "\\t", "\x07": "\\a", "\b": "\\b", "\f": "\\f", "\v": "\\v" };
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0);
    if (named[char]) out += named[char];
    else if (code < 0x20 || code === 0x7f) out += `\\x${code.toString(16).padStart(2, "0")}`;
    else out += char;
  }
  return `"${out}"`;
}

// Go's %q of a []string.
const quoteList = (list) => `[${list.map(quote).join(" ")}]`;

const isTokenChar = (char) => /^[!#$%&'*+\-.^_`|~0-9A-Za-z]$/.test(char);
const isValueChar = (char) => {
  const code = char.codePointAt(0);
  return code >= 0x80 || (code >= 0x20 && code !== 0x7f) || char === "\t";
};
const isControl = (char) => {
  const code = char.codePointAt(0);
  return code < 0x20 || code === 0x7f;
};

// The text's lines, as bufio reads them: without "\r\n" or "\n", with a
// last line that has no newline still read.
function linesOf(text) {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.map((line) => line.replace(/\r$/, ""));
}

const trimASCII = (text) => text.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");

// A header key as Go's textproto stores it: Host, User-Agent. A key with a
// space keeps its case; null for a key Go refuses.
function canonicalKey(key) {
  if (!key) return null;
  let space = false;
  for (const char of key) {
    if (isTokenChar(char)) continue;
    if (char === " ") {
      space = true;
      continue;
    }
    return null;
  }
  if (space) return key;
  return key.toLowerCase().replace(/(^|-)([a-z])/g, (_, dash, letter) => dash + letter.toUpperCase());
}

// Reads the header from lines[at]: { header } with values by key, or
// { error }, where "EOF" means the text ended before the blank line.
function readHeader(lines, at) {
  const header = new Map();
  if (at < lines.length && /^[ \t]/.test(lines[at])) {
    return { error: `malformed MIME header initial line: ${lines[at]}` };
  }
  for (let i = at; ; ) {
    if (i >= lines.length) return { error: "EOF" };
    const line = lines[i++];
    if (line === "") return { header };
    if (!line.includes(":")) return { error: `malformed MIME header: missing colon: ${quote(line)}` };
    let kv = trimASCII(line);
    while (i < lines.length && /^[ \t]/.test(lines[i])) kv += ` ${trimASCII(lines[i++])}`;
    const colon = kv.indexOf(":");
    const key = canonicalKey(kv.slice(0, colon));
    const value = kv.slice(colon + 1);
    if (key === null || ![...value].every(isValueChar)) return { error: `malformed MIME header line: ${kv}` };
    header.set(key, [...(header.get(key) ?? []), value.replace(/^[ \t]+/, "")]);
  }
}

// Go's ParseHTTPVersion: [major, minor], or null.
function parseVersion(version) {
  if (version === "HTTP/1.1") return [1, 1];
  if (version === "HTTP/1.0") return [1, 0];
  const match = /^HTTP\/(\d)\.(\d)$/.exec(version);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

// Go's url.unescape: the first bad %-escape, or "".
function badEscape(text) {
  const at = text.search(/%(?![0-9A-Fa-f]{2})/);
  return at < 0 ? "" : `invalid URL escape ${quote(text.slice(at, at + 3))}`;
}

const isPort = (colonPort) => colonPort === "" || /^:\d*$/.test(colonPort);

// Go's url.parseHost: why the host doesn't parse, or "".
function badHost(host) {
  if (host.startsWith("[")) {
    const close = host.lastIndexOf("]");
    if (close < 0) return "missing ']' in host";
    const colonPort = host.slice(close + 1);
    if (!isPort(colonPort)) return `invalid port ${quote(colonPort)} after host`;
  } else if (host.includes(":")) {
    const colonPort = host.slice(host.lastIndexOf(":"));
    if (!isPort(colonPort)) return `invalid port ${quote(colonPort)} after host`;
  }
  return badEscape(host);
}

// Go's url.ParseRequestURI: why the request target doesn't parse, or "".
function badRequestURI(target) {
  const why = (() => {
    if ([...target].some(isControl)) return "net/url: invalid control character in URL";
    if (target === "") return "empty url";
    if (target === "*") return "";
    let scheme = "";
    let rest = target;
    const schemeMatch = /^([A-Za-z][A-Za-z0-9+.-]*)?:/.exec(target);
    if (schemeMatch) {
      if (!schemeMatch[1]) return "missing protocol scheme";
      scheme = schemeMatch[1];
      rest = target.slice(schemeMatch[0].length);
    }
    rest = rest.endsWith("?") && rest.indexOf("?") === rest.length - 1 ? rest.slice(0, -1) : rest.split("?")[0];
    if (!rest.startsWith("/")) return scheme ? "" : "invalid URI for request";
    if (scheme && rest.startsWith("//")) {
      let authority = rest.slice(2);
      const slash = authority.indexOf("/");
      rest = slash >= 0 ? authority.slice(slash) : "";
      if (slash >= 0) authority = authority.slice(0, slash);
      const at = authority.lastIndexOf("@");
      const host = badHost(authority.slice(at + 1));
      if (host) return host;
      if (at >= 0) {
        const user = authority.slice(0, at);
        if (!/^[A-Za-z0-9\-._:~!$&'()*+,;=%@]*$/.test(user)) return "net/url: invalid userinfo";
        const escape = badEscape(user);
        if (escape) return escape;
      }
    }
    return badEscape(rest);
  })();
  return why ? `parse ${quote(target)}: ${why}` : "";
}

// Go's parseContentLength.
function badContentLength(value) {
  const length = trimASCII(value);
  if (length === "") return `invalid empty Content-Length ${quote(length)}`;
  if (!/^\d+$/.test(length) || BigInt(length) > 2n ** 63n - 1n) return `bad Content-Length ${quote(length)}`;
  return "";
}

// Go's readTransfer checks on the framing headers: the error, or "".
function badFraming(header, [major, minor]) {
  let chunked = false;
  const encodings = header.get("Transfer-Encoding");
  if (encodings && (major > 1 || (major === 1 && minor >= 1))) {
    if (encodings.length !== 1) return `too many transfer encodings: ${quoteList(encodings)}`;
    if (encodings[0].toLowerCase() !== "chunked") return `unsupported transfer encoding: ${quote(encodings[0])}`;
    chunked = true;
  }
  const lengths = header.get("Content-Length") ?? [];
  if (lengths.length > 1 && lengths.some((length) => trimASCII(length) !== trimASCII(lengths[0]))) {
    return `http: message cannot contain multiple Content-Length headers; got ${quoteList(lengths)}`;
  }
  if (lengths.length) {
    const bad = badContentLength(lengths[0]);
    if (bad) return bad;
  }
  if (chunked) {
    for (const value of header.get("Trailer") ?? []) {
      for (const element of value.split(",")) {
        const key = canonicalKey(trimASCII(element)) ?? trimASCII(element);
        if (["Transfer-Encoding", "Trailer", "Content-Length"].includes(key)) return `bad trailer key ${quote(key)}`;
      }
    }
  }
  return "";
}

function checkRequest(text) {
  const lines = linesOf(text);
  if (!lines.length) return "EOF";
  const [first] = lines;
  const space = first.indexOf(" ");
  const second = space < 0 ? -1 : first.indexOf(" ", space + 1);
  if (second < 0) return `malformed HTTP request ${quote(first)}`;
  const method = first.slice(0, space);
  const target = first.slice(space + 1, second);
  const protocol = first.slice(second + 1);
  if (!method || ![...method].every(isTokenChar)) return `invalid method ${quote(method)}`;
  const version = parseVersion(protocol);
  if (!version) return `malformed HTTP version ${quote(protocol)}`;
  // CONNECT names an authority, which Go reads as http://<authority>.
  const uri = method === "CONNECT" && !target.startsWith("/") ? `http://${target}` : target;
  const badURI = badRequestURI(uri);
  if (badURI) return badURI;
  const { header, error } = readHeader(lines, 1);
  if (error) return error === "EOF" ? "unexpected EOF" : error;
  return badFraming(header, version);
}

function checkResponse(text) {
  const lines = linesOf(text);
  if (!lines.length) return "unexpected EOF";
  const [first] = lines;
  const space = first.indexOf(" ");
  if (space < 0) return `malformed HTTP response ${quote(first)}`;
  const protocol = first.slice(0, space);
  const code = first.slice(space + 1).replace(/^ +/, "").split(" ")[0];
  if (code.length !== 3 || !/^[+-]?\d+$/.test(code) || Number(code) < 0) {
    return `malformed HTTP status code ${quote(code)}`;
  }
  const version = parseVersion(protocol);
  if (!version) return `malformed HTTP version ${quote(protocol)}`;
  const { header, error } = readHeader(lines, 1);
  if (error) return error === "EOF" ? "unexpected EOF" : error;
  return badFraming(header, version);
}

/**
 * Why `text` doesn't parse as a held item of `type` ("request" or
 * "response"), in Go's words, or "" when it does. A WebSocket payload is
 * never parsed.
 */
export function checkHTTPParse(text, type) {
  if (type === "request") return checkRequest(String(text ?? ""));
  if (type === "response") return checkResponse(String(text ?? ""));
  return "";
}
