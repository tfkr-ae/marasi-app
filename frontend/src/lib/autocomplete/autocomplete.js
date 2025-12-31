import { snippetCompletion } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { TYPE_DEFINITIONS, MARASI_API } from "./definitions";
import { GLOBAL_SNIPPETS } from "./snippets";

function getMarasiDefinition(path) {
    const parts = path.split(/[\.:]/).filter(Boolean);
    let current = MARASI_API;
    for (const part of parts) {
        if (current[part]) {
            current = current[part];
        } else if (current.children && current.children[part]) {
            current = current.children[part];
        } else {
            return null;
        }
    }
    return current;
}

function resolveType(expression) {
    expression = expression.trim();
    if (!expression) return null;

    if (expression.endsWith("]")) {
        let balance = 0;
        let openIndex = -1;
        for (let i = expression.length - 1; i >= 0; i--) {
            if (expression[i] === "]") balance++;
            if (expression[i] === "[") balance--;
            if (balance === 0) {
                openIndex = i;
                break;
            }
        }

        if (openIndex > 0) {
            const rootExpr = expression.slice(0, openIndex);
            const rootType = resolveType(rootExpr);

            if (rootType && rootType.startsWith("[]")) {
                return rootType.slice(2);
            }
            if (rootType === "table") return "any";
        }
    }

    let balanceParens = 0;
    let inQuote = false;
    let separatorIndex = -1;

    for (let i = expression.length - 1; i >= 0; i--) {
        const char = expression[i];

        if (char === '"' || char === "'") {
            inQuote = !inQuote;
            continue;
        }
        if (inQuote) continue;

        if (char === ")") balanceParens++;
        else if (char === "(") balanceParens--;

        if (balanceParens === 0 && (char === ":" || char === ".")) {
            separatorIndex = i;
            break;
        }
    }

    if (separatorIndex > 0) {
        const rootExpr = expression.slice(0, separatorIndex);
        const callPart = expression.slice(separatorIndex + 1);
        const methodName = callPart.split("(")[0].trim();

        let parentType = resolveType(rootExpr);

        if (!parentType && rootExpr.startsWith("marasi")) {
            const def = getMarasiDefinition(rootExpr);
            if (def && def.children && def.children[methodName]) {
                const childDef = def.children[methodName];
                if (childDef.returnType) return childDef.returnType;
                if (childDef.type && childDef.type !== "method" && childDef.type !== "namespace") return childDef.type;
            }
        }

        if (parentType) {
            const typeDef = TYPE_DEFINITIONS[parentType];
            if (typeDef) {
                if (typeDef.methods && typeDef.methods[methodName]) {
                    return typeDef.methods[methodName].returnType;
                }
                if (typeDef.properties && typeDef.properties[methodName]) {
                    return typeDef.properties[methodName].type;
                }
            }
        }
        return null;
    }

    const lower = expression.toLowerCase();

    if (lower === "req" || lower.endsWith("request") || lower.endsWith("req")) return "http.Request";
    if (lower === "res" || lower.endsWith("response") || lower.endsWith("res")) return "http.Response";
    if (lower === "url" || lower.endsWith("url")) return "url.URL";
    if (lower === "headers" || lower.endsWith("header") || lower.endsWith("headers")) return "http.Header";
    if (lower === "cookie" || lower.endsWith("cookie")) return "http.Cookie";
    if (lower === "builder" || lower.endsWith("builder") || lower.endsWith("requestbuilder")) return "RequestBuilder";
    if (lower === "scope" || lower.endsWith("scope") || lower.endsWith("compass")) return "compass.Scope";
    if (lower === "regexp" || lower.endsWith("regexp")) return "regexp.Regexp";

    if (lower.endsWith("summary")) return "repo.Summary";
    if (lower.endsWith("details")) return "repo.Details";
    if (lower.endsWith("requestdata")) return "repo.RequestData";
    if (lower.endsWith("responsedata")) return "repo.ResponseData";

    return null;
}

export function marasiCompletionSource(context) {
    let node = syntaxTree(context.state).resolveInner(context.pos, -1);
    if (node.name === "string" || node.name === "comment") {
        return null;
    }

    const word = context.matchBefore(/[a-zA-Z0-9_.:\[\]\(\)"',\s]+/);
    if (!word) return null;

    const rawText = word.text;

    let cleanStartIndex = 0;
    let balance = 0;
    let inQuote = false;

    for (let i = rawText.length - 1; i >= 0; i--) {
        const char = rawText[i];

        if (char === '"' || char === "'") { inQuote = !inQuote; continue; }
        if (inQuote) continue;

        if (char === ')') balance++;
        else if (char === ']') balance++;
        else if (char === '}') balance++;
        else if (char === '(') balance--;
        else if (char === '[') balance--;
        else if (char === '{') balance--;

        if (balance < 0 || (balance === 0 && (char === ',' || char === ' ' || char === '\t' || char === '\n' || char === '=' || char === '+' || char === '-'))) {
            cleanStartIndex = i + 1;
            break;
        }
    }

    const text = rawText.slice(cleanStartIndex).trim();
    const completionFrom = word.from + cleanStartIndex + (rawText.slice(cleanStartIndex).length - text.length);

    if (!text) return null;

    let separatorIndex = -1;
    inQuote = false;
    balance = 0;

    for (let i = text.length - 1; i >= 0; i--) {
        const char = text[i];
        if (char === '"' || char === "'") inQuote = !inQuote;
        if (inQuote) continue;
        if (char === ')') balance++;
        if (char === '(') balance--;

        if (balance === 0 && (char === ':' || char === '.')) {
            separatorIndex = i;
            break;
        }
    }

    if (separatorIndex === -1) {
        const snippets = GLOBAL_SNIPPETS.filter(s => s.label.startsWith(text));
        if (snippets.length) return { from: completionFrom, options: snippets };
        if (text.startsWith("mar")) return { from: completionFrom, options: [{ label: "marasi", type: "namespace" }] };
        return null;
    }

    const prefix = text.slice(0, separatorIndex);
    const separator = text[separatorIndex];
    const suffix = text.slice(separatorIndex + 1);

    const isMethodCall = separator === ":";
    const isPropertyAccess = separator === ".";

    const propCompletionFrom = completionFrom + separatorIndex + 1;
    const resolvedType = resolveType(prefix);

    if (resolvedType) {
        const typeDef = TYPE_DEFINITIONS[resolvedType];
        let options = [];

        if (typeDef && typeDef.methods && !isPropertyAccess) {
            const methodOptions = Object.entries(typeDef.methods)
                .filter(([name]) => name.startsWith(suffix))
                .map(([name, data]) => {
                    return snippetCompletion(`${name}${data.args}`, {
                        label: name,
                        type: "function",
                        detail: `${data.argLabel} -> ${data.returnType} | ${data.details}`,
                        boost: 95
                    });
                });
            options = options.concat(methodOptions);
        }

        if (typeDef && typeDef.properties && isPropertyAccess) {
            const propOptions = Object.entries(typeDef.properties)
                .filter(([name]) => name.startsWith(suffix))
                .map(([name, data]) => {
                    return {
                        label: name,
                        type: "property",
                        detail: `${data.type} | ${data.details}`,
                        boost: 95
                    };
                });
            options = options.concat(propOptions);
        }

        if (options.length > 0) {
            return { from: propCompletionFrom, options };
        }
    }

    if (prefix.startsWith("marasi")) {
        const parts = prefix.split(/[\.:]/).filter(Boolean);
        let currentDef = MARASI_API;

        for (const part of parts) {
            if (currentDef[part] && currentDef[part].children) {
                currentDef = currentDef[part].children;
            } else if (currentDef.children && currentDef.children[part]) {
                currentDef = currentDef.children[part].children;
            } else {
                return null;
            }
        }

        if (currentDef) {
            const options = Object.keys(currentDef)
                .filter(key => key.startsWith(suffix))
                .map((key) => {
                    const item = currentDef[key];
                    const isMethod = item.type === "method";

                    if (isPropertyAccess && isMethod) return null;
                    if (isMethodCall && !isMethod) return null;

                    if (isMethod) {
                        return snippetCompletion(
                            `${key}${item.args}`,
                            {
                                label: key,
                                type: "function",
                                detail: `${item.argLabel} -> ${item.returnType} | ${item.details}`,
                                boost: 99
                            }
                        );
                    } else {
                        return {
                            label: key,
                            type: "namespace",
                            detail: item.details,
                            boost: 99
                        };
                    }
                }).filter(Boolean);

            if (options.length > 0) return { from: propCompletionFrom, options };
        }
    }

    return null;
}
