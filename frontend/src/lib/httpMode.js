// The HTTP message highlighting every raw editor uses: CodeMirror's legacy
// http mode (@codemirror/legacy-modes/mode/http), widened for Marasi's
// HTTP/2 text form (marasi h2engine_fields.go h2RequestText): a version
// with no minor ("GET / HTTP/2", "HTTP/2 200") and pseudo-header field
// lines (":authority: shop.test"), whose name ends at the first colon after
// its first character. Use it with StreamLanguage.define(http).

function failFirstLine(stream, state) {
  stream.skipToEnd();
  state.cur = header;
  return "error";
}

function start(stream, state) {
  if (stream.match(/^HTTP\/\d(\.\d)?(?=\s|$)/)) {
    state.cur = responseStatusCode;
    return "keyword";
  } else if (stream.match(/^[A-Z]+/) && /[ \t]/.test(stream.peek())) {
    state.cur = requestPath;
    return "keyword";
  } else {
    return failFirstLine(stream, state);
  }
}

function responseStatusCode(stream, state) {
  const code = stream.match(/^\d+/);
  if (!code) return failFirstLine(stream, state);
  state.cur = responseStatusText;
  const status = Number(code[0]);
  return status >= 100 && status < 400 ? "atom" : "error";
}

function responseStatusText(stream, state) {
  stream.skipToEnd();
  state.cur = header;
  return null;
}

function requestPath(stream, state) {
  stream.eatWhile(/\S/);
  state.cur = requestProtocol;
  return "string.special";
}

function requestProtocol(stream, state) {
  if (stream.match(/^HTTP\/\d(\.\d)?$/)) {
    state.cur = header;
    return "keyword";
  }
  return failFirstLine(stream, state);
}

function header(stream) {
  if (stream.sol() && !stream.eat(/[ \t]/)) {
    if (stream.match(/^:?[^:]*:/)) return "atom";
    stream.skipToEnd();
    return "error";
  }
  stream.skipToEnd();
  return "string";
}

function body(stream) {
  stream.skipToEnd();
  return null;
}

export const http = {
  name: "http",
  token(stream, state) {
    const cur = state.cur;
    if (cur != header && cur != body && stream.eatSpace()) return null;
    return cur(stream, state);
  },
  blankLine(state) {
    state.cur = body;
  },
  startState() {
    return { cur: start };
  },
};
