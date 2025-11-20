const canDecodeBuffer =
  typeof Buffer !== "undefined" && typeof Buffer.from === "function";

function decodeBase64(chunk) {
  try {
    if (typeof atob === "function") {
      return atob(chunk);
    }
    if (canDecodeBuffer) {
      return Buffer.from(chunk, "base64").toString("utf-8");
    }
  } catch (error) {
    console.error("Base64 decode failed", error);
  }
  return "";
}

function ensureArray(value) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => ensureArray(entry));
  }
  if (typeof value === "object") {
    return Object.values(value).flatMap((entry) => ensureArray(entry));
  }
  return [value];
}

function ensureString(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return value.toString();
  }
  if (value instanceof Uint8Array) {
    try {
      return new TextDecoder().decode(value);
    } catch (error) {
      console.error("Failed to decode Uint8Array", error);
    }
  }
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
}

function normalizeString(value) {
  return ensureString(value).trim().toLowerCase();
}

const FIELD_ALIASES = {
  method: "request.method",
  host: "request.host",
  path: "request.path",
  url: "request.raw",
  scheme: "request.scheme",
  body: "request.body",
  query: "request.query",
  status: "response.status",
  "status-text": "response.statustext",
  statustext: "response.statustext",
  contenttype: "response.contenttype",
  "content-type": "response.contenttype",
  ctype: "response.contenttype",
  length: "response.length",
  "content-length": "response.length",
  clength: "response.length",
  responsebody: "response.body",
};

function normalizeFieldPath(path) {
  if (!path) return path;
  const lowered = path.toLowerCase();
  return FIELD_ALIASES[lowered] ?? path;
}

function extractNumericCandidate(value) {
  if (value === undefined || value === null) return NaN;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const stringValue = ensureString(value);
  const matches = stringValue.match(/-?\d+(?:\.\d+)?/g);
  if (!matches || matches.length === 0) {
    return NaN;
  }
  const candidate = parseFloat(matches[matches.length - 1]);
  return Number.isNaN(candidate) ? NaN : candidate;
}

function normalizeEqualityValue(value) {
  if (value === undefined || value === null) {
    return { type: "string", value: "" };
  }
  if (typeof value === "boolean") {
    return { type: "string", value: value ? "true" : "false" };
  }
  const numericValue = extractNumericCandidate(value);
  if (!Number.isNaN(numericValue)) {
    return { type: "number", value: numericValue };
  }
  const stringValue = ensureString(value).trim();
  return { type: "string", value: stringValue.toLowerCase() };
}

function equalityComparator(a, b, invert = false) {
  const left = normalizeEqualityValue(a);
  const right = normalizeEqualityValue(b);
  const result =
    left.type === right.type
      ? left.value === right.value
      : normalizeString(left.value) === normalizeString(right.value);
  return invert ? !result : result;
}

const helperLibrary = {
  hasBase64Url(input) {
    const haystack = ensureString(input);
    if (!haystack) return false;
    const pattern = /(?:[A-Za-z0-9+/]{12,}={0,2})/g;
    let match;
    while ((match = pattern.exec(haystack)) !== null) {
      const decoded = decodeBase64(match[0]);
      if (decoded && /https?:\/\//i.test(decoded)) {
        return true;
      }
    }
    return false;
  },
  reflects(source, target) {
    const sourceValues = Array.from(
      new Set(
        ensureArray(source)
          .map((entry) => ensureString(entry).trim())
          .filter((entry) => entry.length > 3),
      ),
    );
    if (sourceValues.length === 0) return false;
    const targetString = ensureString(target).toLowerCase();
    if (!targetString) return false;
    return sourceValues.some((value) =>
      targetString.includes(value.toLowerCase()),
    );
  },
};

const KEYWORDS = new Set(["AND", "OR", "NOT"]);
const COMPARATORS = new Set([
  "=",
  "==",
  "!=",
  ">",
  "<",
  ">=",
  "<=",
  "~",
  "!~",
  ":",
  "contains",
  "matches",
  "^=",
  "$=",
]);

function tokenize(query) {
  const tokens = [];
  let index = 0;
  while (index < query.length) {
    const char = query[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "(" || char === ")" || char === ",") {
      tokens.push({ type: char, value: char });
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      let end = index + 1;
      let value = "";
      let escaped = false;
      while (end < query.length) {
        const current = query[end];
        if (escaped) {
          value += current;
          escaped = false;
        } else if (current === "\\") {
          escaped = true;
        } else if (current === char) {
          break;
        } else {
          value += current;
        }
        end += 1;
      }
      if (query[end] !== char) {
        throw new Error("Unterminated string literal");
      }
      tokens.push({ type: "string", value });
      index = end + 1;
      continue;
    }
    if (char === "/") {
      let end = index + 1;
      let escaped = false;
      let pattern = "";
      while (end < query.length) {
        const current = query[end];
        if (escaped) {
          pattern += current;
          escaped = false;
        } else if (current === "\\") {
          escaped = true;
        } else if (current === "/") {
          break;
        } else {
          pattern += current;
        }
        end += 1;
      }
      if (query[end] !== "/") {
        throw new Error("Unterminated regex literal");
      }
      end += 1;
      let flags = "";
      while (/[a-z]/i.test(query[end])) {
        flags += query[end];
        end += 1;
      }
      tokens.push({ type: "regex", value: { pattern, flags } });
      index = end;
      continue;
    }
    const twoChar = query.slice(index, index + 2);
    if (["!=", ">=", "<=", "!~", "^=", "$=", "=="].includes(twoChar)) {
      tokens.push({ type: "operator", value: twoChar });
      index += 2;
      continue;
    }
    const opMatch = query.slice(index).match(/^(contains|matches)/i);
    if (opMatch) {
      tokens.push({ type: "operator", value: opMatch[0].toLowerCase() });
      index += opMatch[0].length;
      continue;
    }
    if (["=", ">", "<", "~", ":"].includes(char)) {
      tokens.push({ type: "operator", value: char });
      index += 1;
      continue;
    }
    const wordMatch = query.slice(index).match(/^[A-Za-z0-9_\-.*]+/);
    if (wordMatch) {
      const [word] = wordMatch;
      tokens.push({ type: "word", value: word });
      index += word.length;
      continue;
    }
    throw new Error(`Unexpected character '${char}' in query`);
  }
  tokens.push({ type: "EOF" });
  return tokens;
}

function buildParser(tokens) {
  let position = 0;

  function peek(offset = 0) {
    return tokens[position + offset];
  }
  function consume(expectedType, message = "Unexpected token") {
    const token = tokens[position];
    if (token.type !== expectedType) {
      throw new Error(message);
    }
    position += 1;
    return token;
  }
  function matchSymbol(symbol) {
    if (peek().type === symbol) {
      position += 1;
      return true;
    }
    return false;
  }
  function matchKeyword(keyword) {
    const token = peek();
    if (
      token.type === "word" &&
      token.value.toUpperCase() === keyword.toUpperCase()
    ) {
      position += 1;
      return true;
    }
    return false;
  }
  function matchComparator() {
    const token = peek();
    if (
      token.type === "operator" &&
      COMPARATORS.has(token.value.toLowerCase())
    ) {
      position += 1;
      const comparator = token.value.toLowerCase();
      return comparator === "==" ? "=" : comparator;
    }
    return null;
  }
  function parseExpression() {
    let node = parseTerm();
    while (matchKeyword("OR")) {
      node = { type: "binary", operator: "OR", left: node, right: parseTerm() };
    }
    return node;
  }
  function parseTerm() {
    let node = parseFactor();
    while (matchKeyword("AND")) {
      node = {
        type: "binary",
        operator: "AND",
        left: node,
        right: parseFactor(),
      };
    }
    return node;
  }
  function parseFactor() {
    if (matchKeyword("NOT")) {
      return { type: "not", operand: parseFactor() };
    }
    if (matchSymbol("(")) {
      const expr = parseExpression();
      if (!matchSymbol(")")) {
        throw new Error("Missing closing parenthesis");
      }
      return expr;
    }
    return parseCondition();
  }
  function parseCondition() {
    const left = parseValueRef();
    const comparator = matchComparator();
    if (comparator) {
      const right = parseValueRef();
      return { type: "comparison", comparator, left, right };
    }
    if (left.type === "function" || left.type === "value") {
      return { type: "valueCondition", value: left };
    }
    throw new Error("Expected comparison or predicate");
  }
  function parseValueRef() {
    const token = peek();
    if (token.type === "word" && KEYWORDS.has(token.value.toUpperCase())) {
      throw new Error(`Unexpected keyword ${token.value}`);
    }
    if (token.type === "word" && peek(1)?.type === "(") {
      return parseFunctionCall();
    }
    if (token.type === "word") {
      position += 1;
      if (/^-?\d+(\.\d+)?$/.test(token.value)) {
        return { type: "value", value: parseFloat(token.value) };
      }
      if (token.value.toLowerCase() === "true") {
        return { type: "value", value: true };
      }
      if (token.value.toLowerCase() === "false") {
        return { type: "value", value: false };
      }
      if (token.value === "*") {
        return { type: "value", value: "*" };
      }
      return { type: "field", path: token.value };
    }
    if (token.type === "string") {
      position += 1;
      return { type: "value", value: token.value };
    }
    if (token.type === "regex") {
      position += 1;
      return {
        type: "value",
        value: new RegExp(token.value.pattern, token.value.flags),
      };
    }
    throw new Error("Unexpected value in expression");
  }
  function parseFunctionCall() {
    const name = consume("word", "Expected function name").value;
    consume("(", "Expected '(' after function name");
    const args = [];
    if (!matchSymbol(")")) {
      args.push(parseValueRef());
      while (matchSymbol(",")) {
        args.push(parseValueRef());
      }
      if (!matchSymbol(")")) {
        throw new Error("Expected ')' after function arguments");
      }
    }
    return { type: "function", name, args };
  }

  const ast = parseExpression();
  if (peek().type !== "EOF") {
    throw new Error("Unexpected trailing tokens");
  }
  return ast;
}

function getFieldValue(row, path) {
  if (!path || !row) return undefined;
  const normalizedPath = normalizeFieldPath(path);
  const [root, ...rest] = normalizedPath.split(".");
  const mappedRoots = {
    request: "Request",
    response: "Response",
    metadata: "Metadata",
  };
  let current = row[mappedRoots[root.toLowerCase()]] ?? row[root];
  if (!current) return undefined;
  for (const segment of rest) {
    if (!segment || segment === "*") {
      current = ensureArray(current);
      continue;
    }
    if (current === undefined || current === null) {
      return undefined;
    }
    if (typeof current !== "object") {
      return undefined;
    }
    const exact = Object.prototype.hasOwnProperty.call(current, segment)
      ? current[segment]
      : undefined;
    if (exact !== undefined) {
      current = exact;
      continue;
    }
    const matchedKey = Object.keys(current).find(
      (key) => key.toLowerCase() === segment.toLowerCase(),
    );
    current = matchedKey ? current[matchedKey] : undefined;
  }
  return current;
}

function resolveValue(node, row, helpers) {
  if (!node) return undefined;
  switch (node.type) {
    case "value":
      return node.value;
    case "field":
      return getFieldValue(row, node.path);
    case "function":
      return executeHelper(node, row, helpers);
    default:
      return undefined;
  }
}

function executeHelper(node, row, helpers) {
  const helperName = node.name.toLowerCase();
  const helperEntry = Object.entries(helpers).find(
    ([key]) => key.toLowerCase() === helperName,
  );
  if (!helperEntry) {
    throw new Error(`Unknown helper function ${node.name}`);
  }
  const [, helperFn] = helperEntry;
  const resolvedArgs = node.args.map((arg) => resolveValue(arg, row, helpers));
  return helperFn(...resolvedArgs);
}

function compareValues(leftNode, rightNode, comparator, row, helpers) {
  const left = resolveValue(leftNode, row, helpers);
  const right = resolveValue(rightNode, row, helpers);
  const leftValues = ensureArray(left);
  const rightValues = ensureArray(right);

  const compareFn = {
    "=": (a, b) => equalityComparator(a, b),
    "!=": (a, b) => equalityComparator(a, b, true),
    ">": (a, b) =>
      extractNumericCandidate(a) > extractNumericCandidate(b),
    "<": (a, b) =>
      extractNumericCandidate(a) < extractNumericCandidate(b),
    ">=": (a, b) =>
      extractNumericCandidate(a) >= extractNumericCandidate(b),
    "<=": (a, b) =>
      extractNumericCandidate(a) <= extractNumericCandidate(b),
    "~": (a, b) => {
      const regex = b instanceof RegExp ? b : new RegExp(ensureString(b), "i");
      return regex.test(ensureString(a));
    },
    "!~": (a, b) => {
      const regex = b instanceof RegExp ? b : new RegExp(ensureString(b), "i");
      return !regex.test(ensureString(a));
    },
    ":": (a, b) =>
      ensureString(a).toLowerCase().includes(ensureString(b).toLowerCase()),
    contains: (a, b) =>
      ensureString(a).toLowerCase().includes(ensureString(b).toLowerCase()),
    matches: (a, b) => {
      const regex = b instanceof RegExp ? b : new RegExp(ensureString(b), "i");
      return regex.test(ensureString(a));
    },
    "^=": (a, b) =>
      ensureString(a).toLowerCase().startsWith(ensureString(b).toLowerCase()),
    "$=": (a, b) =>
      ensureString(a).toLowerCase().endsWith(ensureString(b).toLowerCase()),
  }[comparator];

  if (!compareFn) return false;

  return leftValues.some((leftValue) =>
    rightValues.some((rightValue) => compareFn(leftValue, rightValue)),
  );
}

function evaluateAst(ast, row, helpers = helperLibrary) {
  switch (ast.type) {
    case "binary": {
      const left = evaluateAst(ast.left, row, helpers);
      if (ast.operator === "AND") {
        return left && evaluateAst(ast.right, row, helpers);
      }
      return left || evaluateAst(ast.right, row, helpers);
    }
    case "not":
      return !evaluateAst(ast.operand, row, helpers);
    case "comparison":
      return compareValues(ast.left, ast.right, ast.comparator, row, helpers);
    case "valueCondition":
      return Boolean(resolveValue(ast.value, row, helpers));
    default:
      return false;
  }
}

export function compileHttpql(query) {
  const trimmed = query?.trim();
  if (!trimmed) {
    return { ast: null, error: null, test: () => true };
  }
  try {
    const tokens = tokenize(trimmed);
    const ast = buildParser(tokens);
    return {
      ast,
      error: null,
      test: (row, helpers = helperLibrary) => evaluateAst(ast, row, helpers),
    };
  } catch (error) {
    return {
      ast: null,
      error,
      test: () => false,
    };
  }
}

export const defaultHttpqlHelpers = helperLibrary;
export const __private__ = { tokenize, buildParser, evaluateAst, helperLibrary };
