import { NodeSet, NodeType, Parser, Tree } from "@lezer/common";
import { styleTags, tags as t } from "@lezer/highlight";

const formNodeSet = new NodeSet([
  NodeType.none,
  NodeType.define({ id: 1, name: "FormBody", top: true }),
  NodeType.define({ id: 2, name: "FormKey" }),
  NodeType.define({ id: 3, name: "FormEquals" }),
  NodeType.define({ id: 4, name: "FormValue" }),
  NodeType.define({ id: 5, name: "FormAmpersand" }),
]).extend(
  styleTags({
    FormKey: t.propertyName,
    FormEquals: t.operator,
    FormValue: t.string,
    FormAmpersand: t.atom,
  }),
);

const T_BODY = formNodeSet.types[1];
const T_KEY = formNodeSet.types[2];
const T_EQUALS = formNodeSet.types[3];
const T_VALUE = formNodeSet.types[4];
const T_AMP = formNodeSet.types[5];

class FormParse {
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
    const push = (type, relFrom, relTo) => {
      if (relTo > relFrom) {
        children.push(new Tree(type, [], [], relTo - relFrom));
        positions.push(relFrom);
      }
    };

    let i = 0;
    while (i < len) {
      let amp = text.indexOf("&", i);
      const segEnd = amp >= 0 ? amp : len;

      if (segEnd > i) {
        const eq = text.indexOf("=", i);
        if (eq >= 0 && eq < segEnd) {
          push(T_KEY, i, eq);
          push(T_EQUALS, eq, eq + 1);
          push(T_VALUE, eq + 1, segEnd);
        } else {
          push(T_KEY, i, segEnd);
        }
      }

      if (amp >= 0) {
        push(T_AMP, amp, amp + 1);
        i = amp + 1;
      } else {
        i = segEnd;
      }
    }

    this.parsedPos = end;
    return new Tree(T_BODY, children, positions, end - origin).balance();
  }
}

class FormUrlEncodedParser extends Parser {
  createParse(input, _fragments, ranges) {
    return new FormParse(input, ranges);
  }
}

/** Lightweight permissive Lezer parser for `application/x-www-form-urlencoded` bodies. */
export const formUrlEncodedParser = new FormUrlEncodedParser();
