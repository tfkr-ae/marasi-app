import { NodeProp, NodeSet, NodeType, Parser, Tree, parseMixed } from "@lezer/common";
import { languageDataProp } from "@codemirror/language";
import { styleTags, tags as t } from "@lezer/highlight";

export const bodyMetaProp = new NodeProp({ perNode: true });

export function createHeadNodeSet(languageDataFacet) {
  const types = [
    NodeType.none,
    NodeType.define({ id: 1, name: "HttpMessage", top: true }),
    NodeType.define({ id: 2, name: "Method" }),
    NodeType.define({ id: 3, name: "RequestTarget" }),
    NodeType.define({ id: 4, name: "Protocol" }),
    NodeType.define({ id: 5, name: "StatusCode" }),
    NodeType.define({ id: 6, name: "InvalidHead" }),
    NodeType.define({ id: 7, name: "HeaderName" }),
    NodeType.define({ id: 8, name: "HeaderValue" }),
    NodeType.define({ id: 9, name: "Body" }),
  ];

  return new NodeSet(types).extend(
    languageDataProp.add((type) => (type.isTop ? languageDataFacet : undefined)),
    styleTags({
      Method: t.keyword,
      RequestTarget: t.special(t.string),
      Protocol: t.keyword,
      StatusCode: t.atom,
      InvalidHead: t.invalid,
      HeaderName: t.atom,
      HeaderValue: t.string,
    }),
  );
}

const HTTP_VERSION_START = /^HTTP\/\d(?:\.\d)?(?=[ \t]|$)/;
const HTTP_VERSION_EXACT = /^HTTP\/\d(?:\.\d)?$/;
const REQUEST_METHOD = /^[A-Z]+(?=[ \t])/;
const DIGITS = /^\d+/;

function readLine(input, pos, end) {
  if (pos >= end) return null;
  let text = "";
  let cur = pos;
  while (cur < end) {
    let chunk = input.chunk(cur);
    if (!chunk.length) break;
    if (cur + chunk.length > end) chunk = chunk.slice(0, end - cur);
    const nl = chunk.indexOf("\n");
    if (nl >= 0) {
      text += chunk.slice(0, nl);
      const lineEnd = cur + nl;
      const content = text.endsWith("\r") ? text.slice(0, -1) : text;
      return { content, contentEnd: pos + content.length, nextPos: lineEnd + 1 };
    }
    text += chunk;
    cur += chunk.length;
  }
  const content = text.endsWith("\r") ? text.slice(0, -1) : text;
  return { content, contentEnd: pos + content.length, nextPos: cur };
}

function skipHorizontalSpace(text, idx) {
  while (idx < text.length && (text[idx] === " " || text[idx] === "\t")) idx++;
  return idx;
}

class HttpHeadParse {
  constructor(nodeSet, input, ranges) {
    this.nodeSet = nodeSet;
    this.input = input;
    this.start = ranges.length ? ranges[0].from : 0;
    this.end = ranges.length ? ranges[ranges.length - 1].to : input.length;
    this.parsedPos = this.start;
  }

  stopAt() {}

  advance() {
    const types = this.nodeSet.types;
    const T_MESSAGE = types[1];
    const T_METHOD = types[2];
    const T_TARGET = types[3];
    const T_PROTOCOL = types[4];
    const T_STATUS = types[5];
    const T_INVALID = types[6];
    const T_HEADER_NAME = types[7];
    const T_HEADER_VALUE = types[8];
    const T_BODY = types[9];

    const children = [];
    const positions = [];
    const origin = this.start;

    const pushToken = (type, from, to) => {
      if (to > from) {
        children.push(new Tree(type, [], [], to - from));
        positions.push(from - origin);
      }
    };

    let pos = this.start;
    const end = this.end;
    let bodyStart = -1;
    let contentType = "";
    let lastHeaderName = "";

    const first = readLine(this.input, pos, end);
    if (first) {
      const line = first.content;
      if (line.length === 0) {
        bodyStart = first.nextPos;
      } else {
        let idx = skipHorizontalSpace(line, 0);
        const rest = line.slice(idx);
        const verMatch = HTTP_VERSION_START.exec(rest);
        if (verMatch) {
          pushToken(T_PROTOCOL, pos + idx, pos + idx + verMatch[0].length);
          idx += verMatch[0].length;
          idx = skipHorizontalSpace(line, idx);
          if (idx < line.length) {
            const codeMatch = DIGITS.exec(line.slice(idx));
            if (!codeMatch) {
              pushToken(T_INVALID, pos + idx, pos + line.length);
            } else {
              const status = Number(codeMatch[0]);
              const type = status >= 100 && status < 400 ? T_STATUS : T_INVALID;
              pushToken(type, pos + idx, pos + idx + codeMatch[0].length);
            }
          }
        } else {
          const methodMatch = REQUEST_METHOD.exec(rest);
          if (methodMatch) {
            pushToken(T_METHOD, pos + idx, pos + idx + methodMatch[0].length);
            idx += methodMatch[0].length;
            idx = skipHorizontalSpace(line, idx);
            if (idx < line.length) {
              const targetStart = idx;
              while (idx < line.length && line[idx] !== " " && line[idx] !== "\t") idx++;
              pushToken(T_TARGET, pos + targetStart, pos + idx);
              idx = skipHorizontalSpace(line, idx);
              if (idx < line.length) {
                const protoText = line.slice(idx);
                if (HTTP_VERSION_EXACT.test(protoText)) {
                  pushToken(T_PROTOCOL, pos + idx, pos + line.length);
                } else {
                  pushToken(T_INVALID, pos + idx, pos + line.length);
                }
              }
            }
          } else {
            pushToken(T_INVALID, pos + idx, pos + line.length);
          }
        }
        pos = first.nextPos;
      }
    }

    while (bodyStart < 0 && pos < end) {
      const lineInfo = readLine(this.input, pos, end);
      if (!lineInfo) break;
      const line = lineInfo.content;
      if (line.length === 0) {
        bodyStart = lineInfo.nextPos;
        break;
      }
      if (line[0] === " " || line[0] === "\t") {
        pushToken(T_HEADER_VALUE, pos, pos + line.length);
        if (lastHeaderName === "content-type") {
          contentType += " " + line.trim();
        }
      } else {
        const colon = line[0] === ":" ? line.indexOf(":", 1) : line.indexOf(":");
        if (colon > 0) {
          pushToken(T_HEADER_NAME, pos, pos + colon + 1);
          const valueStart = pos + colon + 1;
          const valueEnd = pos + line.length;
          if (valueEnd > valueStart) {
            pushToken(T_HEADER_VALUE, valueStart, valueEnd);
          }
          const rawName = line.slice(0, colon);
          if (!rawName.startsWith(":")) {
            lastHeaderName = rawName.toLowerCase();
            if (lastHeaderName === "content-type" && !contentType) {
              contentType = line.slice(colon + 1).trim();
            }
          } else {
            lastHeaderName = "";
          }
        } else {
          pushToken(T_INVALID, pos, pos + line.length);
          lastHeaderName = "";
        }
      }
      pos = lineInfo.nextPos;
    }

    if (bodyStart >= 0 && bodyStart < end) {
      const bodyTree = new Tree(T_BODY, [], [], end - bodyStart, [[bodyMetaProp, { contentType }]]);
      children.push(bodyTree);
      positions.push(bodyStart - origin);
    }

    this.parsedPos = end;
    return new Tree(T_MESSAGE, children, positions, end - origin);
  }
}

export class HttpParser extends Parser {
  constructor(nodeSet, nest = null) {
    super();
    this.nodeSet = nodeSet;
    this.wrapper = nest ? parseMixed(nest) : null;
  }

  createParse(input, fragments, ranges) {
    let parse = new HttpHeadParse(this.nodeSet, input, ranges);
    if (this.wrapper) parse = this.wrapper(parse, input, fragments, ranges);
    return parse;
  }
}
