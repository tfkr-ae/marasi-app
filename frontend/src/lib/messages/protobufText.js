// A small highlighter for Marasi's protobuf text form (GLOSSARY Protobuf
// text form): schemaless protoscope, as in
//
//   1:VARINT 1
//   2:LEN {"server"}
//   3: { 1: 5 }
//
// Field numbers, wire types, strings, hex literals (`0a1b`), numbers,
// braces and # comments. A legacy-mode tokenizer for StreamLanguage.define.
import { StreamLanguage } from "@codemirror/language";
import { json } from "@codemirror/legacy-modes/mode/javascript";

const WIRE_TYPES = /^(?:VARINT|I64|LEN|SGROUP|EGROUP|I32)\b/;

export const protobufText = {
  name: "protobuf-text",
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match("#")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match(/^\d+:/)) return "def";
    if (stream.match(WIRE_TYPES)) return "keyword";
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return "string";
    if (stream.match(/^`[0-9a-fA-F\s]*`?/)) return "string-2";
    if (stream.match(/^-?(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)(?:i32|i64|z)?/)) return "number";
    if (stream.match(/^(?:true|false|inf|nan)\b/)) return "atom";
    if (stream.match(/^[{}]/)) return "bracket";
    stream.next();
    return null;
  },
};

const LANGUAGES = {
  protobuf: StreamLanguage.define(protobufText),
  json: StreamLanguage.define(json),
};

/** The editor extensions for a detail's language ("protobuf", "json" or null). */
export const languageExtensions = (language) => (LANGUAGES[language] ? [LANGUAGES[language]] : []);
