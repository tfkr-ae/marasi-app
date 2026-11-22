// How the Messages modal shows a stream message (GLOSSARY Stream message):
// its size, preview and chips in the list, and the text its detail pane
// shows for each view. Pure JS, for `node --test`.
//
// The detail's text view is the protobuf text form when Marasi gives one,
// otherwise the payload as UTF-8 text, or as read-only hex when it isn't
// text. A gRPC-Web trailer message (flags 128) and a Connect end of stream
// (flags 2) are stored as ordinary messages whose text form is a
// meaningless hex literal, so they are labelled and show their payload as
// text instead.
import { formatSize } from "../websocket/presentation.js";

/**
 * The framings whose messages Marasi reads and writes as a text form: the
 * protobuf text form, or for a +json codec the JSON itself. The others
 * (SSE, NDJSON) are UTF-8 text.
 */
export const TEXT_FORM_FRAMINGS = new Set(["grpc", "grpc-web", "connect"]);

/** The most payload a stream_message event carries (Marasi's limit). */
const EVENT_PAYLOAD_LIMIT = "64 KB";

const PREVIEW_CHARS = 160;

function bytesOf(base64) {
  if (!base64) return new Uint8Array();
  try {
    return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
}

// The bytes as text when they are valid UTF-8 with no control characters
// but tab, line feed and carriage return; null otherwise.
function textOf(bytes) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) ? null : text;
}

const hexOf = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");

/** "Trailers" or "End of stream" for a message that ends its direction, else "". */
export function endingKind(message) {
  const flags = message?.Flags ?? 0;
  if (message?.Framing === "grpc-web" && flags & 0x80) return "Trailers";
  if (message?.Framing === "connect" && flags & 0x02) return "End of stream";
  return "";
}

/** The message's size, or that it was too large for its event. */
export function messageSize(message) {
  if (message.PayloadTruncated && !message.Payload) return `> ${EVENT_PAYLOAD_LIMIT}`;
  return formatSize(bytesOf(message.Payload).length);
}

const oneLine = (text) => text.replace(/\s+/g, " ").trim();
const clip = (text) => (text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text);

/**
 * A line for the list: text as one line; for binary, such as protobuf, the
 * readable strings in it, else its first bytes in hex.
 */
export function messagePreview(message) {
  if (message.PayloadTruncated && !message.Payload) return "Select to load the payload";
  const bytes = bytesOf(message.Payload);
  if (endingKind(message)) return clip(oneLine(new TextDecoder().decode(bytes)));
  const text = textOf(bytes);
  if (text !== null) return clip(oneLine(text));
  const strings = (new TextDecoder().decode(bytes).match(/[\x20-\x7e]{3,}/g) ?? []).map((s) => s.trim()).filter(Boolean);
  if (strings.length) return clip(strings.join(" · "));
  const head = bytes.slice(0, 24);
  return bytes.length > head.length ? `${hexOf(head)} …` : hexOf(head);
}

// Literal classes so Tailwind's content scan keeps them.
const TONES = {
  ending: "variant-soft-secondary",
  tertiary: "variant-soft-tertiary",
  warning: "variant-soft-warning",
  error: "variant-soft-error",
  surface: "variant-soft-surface",
};

/** The list's chips for what happened to the message, most telling first. */
export function messageChips(message) {
  const m = message.Metadata ?? {};
  const chips = [];
  const add = (label, tone, title) => chips.push({ label, class: TONES[tone], title });
  const ending = endingKind(message);
  if (ending) add(ending, "ending", ending === "Trailers" ? "gRPC-Web trailers, carried as the last message" : "Connect end of stream");
  if (m.injected) add("Injected", "tertiary", "Injected from Marasi");
  if (m.dropped) add("Dropped", "error", "Dropped in Checkpoint; the other side never saw it");
  else if (m.edited) add("Edited", "tertiary", "Edited before it was forwarded");
  else if (m.intercepted) add("Intercepted", "warning", "Intercepted in Checkpoint, then forwarded unchanged");
  if (message.Compressed) add(m.encoding || "compressed", "surface", `Compressed (${m.encoding || "unknown encoding"})`);
  if (m.too_large) add("Too large", "error", `Over the size limit: ${formatSize(m.size_seen)} seen`);
  if (m.inflate_error) add("Corrupt", "error", `Could not decompress: ${m.inflate_error}`);
  if (m.cut_short) add("Cut short", "error", "The stream ended before this message was whole");
  if (message.PayloadTruncated) add("Large", "surface", `Over ${EVENT_PAYLOAD_LIMIT}; loads in full when selected`);
  return chips;
}

/**
 * The codec a gRPC, gRPC-Web or Connect content type names after its +:
 * "json", or "proto" for +proto or none (a port of Marasi's stream.codecOf).
 * null for an empty or other content type, whose codec isn't known.
 */
export function codecOf(contentType) {
  const media = String(contentType ?? "").split(";", 1)[0].trim().toLowerCase();
  const [type, suffix = ""] = media.split("+", 2);
  if (!/^application\/(grpc|grpc-web|connect)$/.test(type)) return null;
  if (suffix === "json") return "json";
  return suffix === "" || suffix === "proto" ? "proto" : null;
}

const looksLikeJSON = (text) => {
  if (!/^\s*[[{]/.test(text)) return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

/** A text form's highlighting: by its codec, else by whether it parses as JSON. */
export function textLanguage(text, codec) {
  if (codec === "json") return "json";
  if (codec === "proto") return "protobuf";
  return looksLikeJSON(text) ? "json" : "protobuf";
}

// The payload as text, or as hex with a note when it isn't text.
function payloadView(bytes) {
  const text = textOf(bytes);
  return text !== null
    ? { text, language: null, note: "" }
    : { text: hexOf(bytes), language: null, note: "No text form; shown as hex" };
}

/**
 * The detail pane's { text, language, note } for `view`: "text" (the text
 * form, else the payload), "raw" (the payload) or "metadata". `detail` is
 * the message's single read (the store's details entry), if any; `codec`
 * its direction's codec (codecOf), null when unknown. language is
 * "protobuf", "json" or null.
 */
export function detailOf(message, detail, view, codec = null) {
  if (view === "metadata") {
    const metadata = {
      direction: message.Direction,
      framing: message.Framing,
      flags: message.Flags,
      compressed: message.Compressed,
      created_at: message.CreatedAt,
      ...(message.PayloadTruncated ? { payload_truncated: true } : {}),
      metadata: message.Metadata ?? {},
    };
    return { text: JSON.stringify(metadata, null, 2), language: "json", note: "" };
  }
  const waiting = message.PayloadTruncated && !detail?.Payload;
  const bytes = bytesOf(detail?.Payload || message.Payload);
  const shown = (() => {
    if (endingKind(message)) return { text: new TextDecoder().decode(bytes), language: null, note: "" };
    if (view === "text" && detail?.Text != null) {
      return { text: detail.Text, language: textLanguage(detail.Text, codec), note: "" };
    }
    const payload = payloadView(bytes);
    // Raw asks for the bytes, so hex there needs no note.
    return view === "raw" ? { ...payload, note: "" } : payload;
  })();
  if (detail?.Error) return { ...shown, note: "Couldn't read the message" };
  if (waiting) return { text: "", language: null, note: "Loading the full payload…" };
  if (detail?.Full) return { ...shown, note: "Full payload loaded: too large for the live event" };
  return shown;
}

/**
 * Copy to Inject: the Inject tab's { direction, text } for `message`, from
 * its text form where Marasi gave one, else its payload as UTF-8 text.
 * `detail` is its single read, if any.
 */
export function injectDraftOf(message, detail) {
  const text =
    detail?.Text != null && !endingKind(message)
      ? detail.Text
      : new TextDecoder().decode(bytesOf(detail?.Payload || message.Payload));
  return { direction: message.Direction, text };
}

/**
 * How a held stream message edits: its protobuf text form when Marasi gives
 * one (textForm), else its payload as UTF-8 text, else read-only hex.
 * `message` is { Payload, Text }; `codec` its direction's codec (codecOf),
 * null when unknown. Returns { text, textForm, editable, language }, where
 * language is "protobuf", "json" or null.
 */
export function editableText(message, codec = null) {
  if (message?.Text != null) {
    const language = textLanguage(message.Text, codec);
    return { text: message.Text, textForm: true, editable: true, language };
  }
  const bytes = bytesOf(message?.Payload);
  const text = textOf(bytes);
  if (text !== null) return { text, textForm: false, editable: true, language: null };
  return { text: hexOf(bytes), textForm: false, editable: false, language: null };
}

// "name: value" lines, as a trailer message carries them.
function trailerLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.match(/^([^:]+):\s*(.*)$/))
    .filter(Boolean)
    .map(([, name, value]) => ({ Name: name.trim(), Value: value.trim() }));
}

/**
 * The trailers a direction's trailer message carries (gRPC-Web), where
 * Marasi stores them as a message rather than as trailers.
 */
export function pairTrailers(messages, direction) {
  const last = [...messages].reverse().find((m) => m.Direction === direction && endingKind(m) === "Trailers");
  return last ? trailerLines(new TextDecoder().decode(bytesOf(last.Payload))) : [];
}

/** HH:MM:SS.mmm, local time. */
export function messageTime(value) {
  if (!value) return "";
  const d = new Date(value);
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  return `${time}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}
