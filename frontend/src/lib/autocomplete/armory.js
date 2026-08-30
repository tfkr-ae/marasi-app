import { snippetCompletion } from "@codemirror/autocomplete";

const chainFunctions = [
  ["upper", "Convert to uppercase"],
  ["lower", "Convert to lowercase"],
  ["reverse", "Reverse the string"],
  ["trim", "Remove surrounding whitespace"],
  ["base64", "Encode as Base64"],
  ["hex", "Encode as hexadecimal"],
  ["sha256", "Calculate the SHA-256 hash"],
  ["urlencode", "URL-encode a query value"],
  ["pathescape", "URL-encode a path value"],
];

const chainNames = new Set(chainFunctions.map(([label]) => label));

const chainCompletions = chainFunctions.map(([label, detail]) => ({
  label,
  type: "function",
  detail,
  apply: `${label}()`,
}));

function payloadSnippet(before) {
  const open = before.lastIndexOf("{{");
  const inside = open > before.lastIndexOf("}}");
  const inner = inside
    ? before.slice(open + 2).replace(/[A-Za-z0-9_]*$/, "")
    : "";
  const template = !inside
    ? '{{.Payload ${1:0} "${2:default}"}}'
    : inner.endsWith(".")
      ? 'Payload ${1:0} "${2:default}"'
      : '.Payload ${1:0} "${2:default}"';
  return snippetCompletion(template, {
    label: "Payload",
    type: "function",
    detail: "Insert a payload position",
  });
}

const templateCompletions = (before) => [
  payloadSnippet(before),
  ...chainFunctions.map(([label, detail]) => ({
    label,
    type: "function",
    detail,
  })),
  snippetCompletion('replace "${1:old}" "${2:new}"', {
    label: "replace",
    type: "function",
    detail: "Replace every matching substring",
  }),
  {
    label: "uuid",
    type: "function",
    detail: "Generate a UUIDv7 value",
  },
];

function chainPartial(before) {
  const dotted = before.match(/\.([A-Za-z0-9_]*)$/);
  if (!dotted) return null;

  const prefix = before.slice(0, dotted.index);
  const previous = prefix.match(/([A-Za-z_][A-Za-z0-9_]*)\(\)$/);
  if (previous) return chainNames.has(previous[1]) ? dotted[1] : null;
  if (/@@[^@\r\n]*@@$/.test(prefix)) return dotted[1];
  return null;
}

export function armoryCompletionSource(context) {
  const before = context.state.sliceDoc(0, context.pos);
  const partial = chainPartial(before);
  if (partial !== null) {
    return {
      from: context.pos - partial.length,
      options: chainCompletions,
      validFor: /^[A-Za-z0-9_]*$/,
    };
  }

  const insideTemplate = before.lastIndexOf("{{") > before.lastIndexOf("}}");
  const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*$/);

  if (insideTemplate) {
    if (before.endsWith("{{") || before.endsWith("{{.")) {
      return { from: context.pos, options: templateCompletions(before) };
    }
    if (!word) return null;
    return { from: word.from, options: templateCompletions(before) };
  }

  if (word && "payload".startsWith(word.text.toLowerCase())) {
    return { from: word.from, options: [payloadSnippet(before)] };
  }
  return null;
}
