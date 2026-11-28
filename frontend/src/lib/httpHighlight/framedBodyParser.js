import { NodeSet, NodeType, Parser, Tree, parseMixed } from "@lezer/common";
import { StreamLanguage, foldNodeProp } from "@codemirror/language";
import { styleTags, tags as t } from "@lezer/highlight";
import { protobufText } from "../messages/protobufText.js";
import { bodyParserFor } from "./bodyParsers.js";
import { formatFromContentType } from "./resolveBody.js";

const MESSAGE_FRAMINGS = new Set(["grpc", "grpc-web", "connect"]);
const MESSAGE_SEPARATOR = "--- message ---";
const COMPRESSED_MESSAGE_SEPARATOR = "--- message compressed ---";

const framedNodeSet = new NodeSet([
  NodeType.none,
  NodeType.define({ id: 1, name: "FramedBody", top: true }),
  NodeType.define({ id: 2, name: "MessageSeparator" }),
  NodeType.define({ id: 3, name: "MessagePayload" }),
  NodeType.define({ id: 4, name: "FramedMessage" }),
]).extend(
  foldNodeProp.add({
    FramedMessage(node, state) {
      const firstLine = state.doc.lineAt(node.from);
      if (node.to <= firstLine.to) return null;
      return { from: firstLine.to, to: node.to };
    },
  }),
  styleTags({
    MessageSeparator: t.heading,
  }),
);

const T_FRAMED_BODY = framedNodeSet.types[1];
const T_SEPARATOR = framedNodeSet.types[2];
const T_PAYLOAD = framedNodeSet.types[3];
const T_FRAMED_MESSAGE = framedNodeSet.types[4];

const protobufTextParser = StreamLanguage.define({
  ...protobufText,
  languageData: {},
}).parser;

function isSeparatorLine(line) {
  const clean = line.endsWith("\r") ? line.slice(0, -1) : line;
  return clean === MESSAGE_SEPARATOR || clean === COMPRESSED_MESSAGE_SEPARATOR;
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
    let sepStart = -1;
    let sepEnd = -1;
    let payloadStart = -1;

    const trimTrailingLineBreak = (relStart, relEnd) => {
      let endPos = relEnd;
      if (endPos > relStart && text.charCodeAt(endPos - 1) === 10 /* \n */) endPos--;
      if (endPos > relStart && text.charCodeAt(endPos - 1) === 13 /* \r */) endPos--;
      return endPos;
    };

    const flushMessage = (relEnd) => {
      if (sepStart >= 0) {
        const msgChildren = [new Tree(T_SEPARATOR, [], [], sepEnd - sepStart)];
        const msgPositions = [0];
        let msgEnd = sepEnd;
        if (payloadStart >= 0 && relEnd > payloadStart) {
          const payloadTree = new Tree(T_PAYLOAD, [], [], relEnd - payloadStart);
          msgChildren.push(payloadTree);
          msgPositions.push(payloadStart - sepStart);
          msgEnd = Math.max(sepEnd, trimTrailingLineBreak(payloadStart, relEnd));
        }
        children.push(new Tree(T_FRAMED_MESSAGE, msgChildren, msgPositions, msgEnd - sepStart));
        positions.push(sepStart);
      } else if (payloadStart >= 0 && relEnd > payloadStart) {
        children.push(new Tree(T_PAYLOAD, [], [], relEnd - payloadStart));
        positions.push(payloadStart);
      }
      sepStart = -1;
      sepEnd = -1;
      payloadStart = -1;
    };

    let pos = 0;
    while (pos < len) {
      const nl = text.indexOf("\n", pos);
      const lineEnd = nl >= 0 ? nl : len;
      const nextPos = nl >= 0 ? nl + 1 : len;
      const rawLine = text.slice(pos, lineEnd);

      if (isSeparatorLine(rawLine)) {
        flushMessage(pos);
        sepStart = pos;
        sepEnd = rawLine.endsWith("\r") ? lineEnd - 1 : lineEnd;
      } else if (payloadStart < 0) {
        payloadStart = pos;
      }

      pos = nextPos;
    }

    flushMessage(len);

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
  return formatFromContentType(contentType) === "json" ? framedJsonParser : framedProtobufParser;
}
