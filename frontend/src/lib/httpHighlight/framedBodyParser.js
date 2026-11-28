import { NodeSet, NodeType, Parser, Tree, parseMixed } from "@lezer/common";
import { StreamLanguage } from "@codemirror/language";
import { styleTags, tags as t } from "@lezer/highlight";
import { protobufText } from "../messages/protobufText.js";
import { bodyParserFor } from "./bodyParsers.js";

const MESSAGE_FRAMINGS = new Set(["grpc", "grpc-web", "connect"]);
const MESSAGE_SEPARATOR = "--- message ---";
const COMPRESSED_MESSAGE_SEPARATOR = "--- message compressed ---";

const framedNodeSet = new NodeSet([
  NodeType.none,
  NodeType.define({ id: 1, name: "FramedBody", top: true }),
  NodeType.define({ id: 2, name: "MessageSeparator" }),
  NodeType.define({ id: 3, name: "MessagePayload" }),
]).extend(
  styleTags({
    MessageSeparator: t.heading,
  }),
);

const T_FRAMED_BODY = framedNodeSet.types[1];
const T_SEPARATOR = framedNodeSet.types[2];
const T_PAYLOAD = framedNodeSet.types[3];

const protobufTextParser = StreamLanguage.define({
  ...protobufText,
  languageData: {},
}).parser;

function isSeparatorLine(line) {
  const clean = line.endsWith("\r") ? line.slice(0, -1) : line;
  return clean === MESSAGE_SEPARATOR || clean === COMPRESSED_MESSAGE_SEPARATOR;
}

function isJsonContentType(contentType) {
  if (!contentType || typeof contentType !== "string") return false;
  const semi = contentType.indexOf(";");
  const mediaType = (semi >= 0 ? contentType.slice(0, semi) : contentType).trim().toLowerCase();
  if (mediaType === "application/json" || mediaType === "text/json") return true;
  const slash = mediaType.indexOf("/");
  return slash > 0 && mediaType.endsWith("+json") && mediaType.length > slash + "+json".length + 1;
}

class FramedBodyParse {
  constructor(input, ranges) {
    this.input = input;
    this.start = ranges.length ? ranges[0].from : 0;
    this.end = ranges.length ? ranges[ranges.length - 1].to : input.length;
    this.parsedPos = this.start;
  }

  stopAt() {}

  advance() {
    const origin = this.start;
    const end = this.end;
    const text = this.input.read(origin, end);
    const len = text.length;

    const children = [];
    const positions = [];
    let payloadStart = -1;

    const flushPayload = (relEnd) => {
      if (payloadStart >= 0 && relEnd > payloadStart) {
        children.push(new Tree(T_PAYLOAD, [], [], relEnd - payloadStart));
        positions.push(payloadStart);
      }
      payloadStart = -1;
    };

    let pos = 0;
    while (pos < len) {
      const nl = text.indexOf("\n", pos);
      const lineEnd = nl >= 0 ? nl : len;
      const nextPos = nl >= 0 ? nl + 1 : len;
      const rawLine = text.slice(pos, lineEnd);

      if (isSeparatorLine(rawLine)) {
        flushPayload(pos);
        const visibleEnd = rawLine.endsWith("\r") ? lineEnd - 1 : lineEnd;
        if (visibleEnd > pos) {
          children.push(new Tree(T_SEPARATOR, [], [], visibleEnd - pos));
          positions.push(pos);
        }
      } else if (payloadStart < 0) {
        payloadStart = pos;
      }

      pos = nextPos;
    }

    flushPayload(len);

    this.parsedPos = end;
    return new Tree(T_FRAMED_BODY, children, positions, end - origin).balance();
  }
}

class FramedBodyParser extends Parser {
  constructor(segmentParser) {
    super();
    this.wrapper = parseMixed((node) => (node.name === "MessagePayload" ? { parser: segmentParser } : null));
  }

  createParse(input, fragments, ranges) {
    const parse = new FramedBodyParse(input, ranges);
    return this.wrapper(parse, input, fragments, ranges);
  }
}

const framedJsonParser = new FramedBodyParser(bodyParserFor("json"));
const framedProtobufParser = new FramedBodyParser(protobufTextParser);

/** Reports whether `framing` uses Armory message-form bodies (grpc, grpc-web, connect). */
export function isMessageFraming(framing) {
  return typeof framing === "string" && MESSAGE_FRAMINGS.has(framing);
}

/** Returns the framed body Lezer parser (JSON or Protobuf text form) for `contentType`. */
export function framedBodyParserFor(contentType) {
  return isJsonContentType(contentType) ? framedJsonParser : framedProtobufParser;
}
