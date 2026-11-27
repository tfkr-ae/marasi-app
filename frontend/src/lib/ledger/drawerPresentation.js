// Pure presentation helpers for the Ledger drawer's command strip, pane
// identifier bar, and note status indicators. Plain JS so they load under node.
import { shortcutLabel } from "../keybindings/keys.js";
import { METHOD_CLASS, statusClass } from "../launchpad/format.js";
import { pairTiming } from "./drawer.js";
import { formatSize, protocolText, protocolTitle, statusText } from "./table.js";

export const DRAWER_CONTEXT = "ledger.drawer-open";

const encoder = new TextEncoder();

/** UTF-8 byte length of `text`, formatted as "512 B" / "2.0 KB", or "" when empty. */
export function byteSizeText(text) {
  if (!text) return "";
  return formatSize(encoder.encode(text).length);
}

/** "Label (⌘⇧R)", or the plain label when the action has no shortcut or no keymap. */
export function shortcutTooltip(label, actionId, keymap) {
  if (!keymap || !actionId) return label;
  const key = shortcutLabel(keymap, actionId);
  return key ? `${label} (${key})` : label;
}

/** True when the pair has a response, from its row, a live incoming response, or its loaded body. */
export function pairHasResponse(pair, { incomingResponse = null, responseBody = "" } = {}) {
  return (
    Number(pair?.StatusCode) > 0 ||
    Number(incomingResponse?.StatusCode) > 0 ||
    Boolean(incomingResponse?.Raw) ||
    Boolean(responseBody)
  );
}

/** Command strip summary for the focused pair. */
export function pairSummary(pair, { number = "", incomingResponse = null, responseBody = "" } = {}) {
  const statusCode =
    Number(incomingResponse?.StatusCode) > 0 ? Number(incomingResponse.StatusCode) : Number(pair?.StatusCode) || 0;
  const hasResponse = pairHasResponse(pair, { incomingResponse, responseBody });
  const host = pair?.Host ?? "";
  const path = pair?.Path ?? "";
  const fullUrl = pair?.Scheme && host ? `${pair.Scheme}://${host}${path}` : `${host}${path}`;
  const timingRow = incomingResponse?.RespondedAt ? { ...pair, RespondedAt: incomingResponse.RespondedAt } : pair;
  return {
    number: number != null && number !== "" ? String(number) : "",
    method: pair?.Method ?? "",
    methodClass: METHOD_CLASS[pair?.Method] ?? "",
    hasResponse,
    statusCode,
    status: statusCode > 0 ? statusText(statusCode) : "pending",
    statusClass: statusClass(statusCode),
    host,
    path,
    fullUrl,
    timing: pairTiming(timingRow),
    protocol: protocolText(pair),
    protocolTitle: protocolTitle(pair),
  };
}

/** Copy actions shared between the command strip and the expanded right actions column. */
export function drawerCopyActions({ hasResponse = false } = {}) {
  return [
    {
      id: "copy-request",
      label: "Copy request",
      shortLabel: "Req",
      icon: "copy",
      actionId: `${DRAWER_CONTEXT}.copy-raw-request`,
      disabled: false,
    },
    {
      id: "copy-response",
      label: "Copy response",
      shortLabel: "Res",
      icon: "file-output",
      actionId: `${DRAWER_CONTEXT}.copy-raw-response`,
      disabled: !hasResponse,
      disabledHint: "No response yet",
    },
    {
      id: "copy-url",
      label: "Copy URL",
      shortLabel: null,
      icon: "link",
      actionId: `${DRAWER_CONTEXT}.copy-url`,
      disabled: false,
    },
    {
      id: "copy-browser-view-url",
      label: "Copy browser view URL",
      shortLabel: null,
      icon: "globe",
      actionId: `${DRAWER_CONTEXT}.copy-browser-view-url`,
      disabled: false,
    },
  ];
}

/** Quick-copy and stream actions shown in the widescreen command strip. */
export function commandStripCopyActions({ hasResponse = false, canOpenStream = false } = {}) {
  return [
    ...(canOpenStream
      ? [
          {
            id: "open-messages",
            label: "Open messages",
            shortLabel: "Messages",
            icon: "radio",
            actionId: `${DRAWER_CONTEXT}.websocket.open-stream`,
            disabled: false,
            accent: true,
          },
        ]
      : []),
    ...drawerCopyActions({ hasResponse }),
  ];
}

/** Outbound workflow actions shown in the right rail and expanded right actions column. */
export function rightRailWorkflowActions({ canOpenStream = false, showChef = true } = {}) {
  return [
    ...(canOpenStream
      ? [
          {
            id: "open-messages",
            label: "Open messages",
            icon: "radio",
            actionId: `${DRAWER_CONTEXT}.websocket.open-stream`,
            group: "stream",
            accent: true,
          },
        ]
      : []),
    {
      id: "send-to-launchpad",
      label: "Send to Launchpad",
      icon: "send",
      actionId: `${DRAWER_CONTEXT}.send-to-launchpad`,
      group: "send",
    },
    {
      id: "send-to-armory",
      label: "Send to Armory",
      icon: "swords",
      actionId: `${DRAWER_CONTEXT}.send-to-armory`,
      group: "send",
    },
    {
      id: "add-to-drawing",
      label: "Add to Drawing",
      icon: "shapes",
      actionId: "global.add-to-drawing",
      group: "tools",
    },
    ...(showChef
      ? [
          {
            id: "send-to-cyberchef",
            label: "Send to CyberChef",
            icon: "cooking-pot",
            actionId: "global.send-to-cyberchef",
            group: "tools",
          },
        ]
      : []),
    {
      id: "create-finding",
      label: "Create finding",
      icon: "shield-alert",
      actionId: `${DRAWER_CONTEXT}.create-finding`,
      group: "record",
    },
    {
      id: "create-test-case",
      label: "Create test case",
      icon: "book-check",
      actionId: `${DRAWER_CONTEXT}.create-test-case`,
      group: "record",
    },
  ];
}

/** Tooltip text for a highlight swatch button. */
export function highlightSwatchTitle(swatch, currentHighlight) {
  return currentHighlight === swatch.number ? `${swatch.label} (click to clear)` : swatch.label;
}

/**
 * Note status dot, tooltip, compact save-state label, and details-column
 * heading tint/label. Neutral grey when saved with a note (primary is red,
 * which reads as failure), amber while edited or saving, red when saving failed.
 */
export function noteIndicator(noteStatus = "saved", hasNote = false, { active = false } = {}) {
  const dot =
    noteStatus === "failed"
      ? "bg-error-500"
      : noteStatus !== "saved"
        ? "bg-warning-500"
        : hasNote
          ? "bg-surface-500 dark:bg-surface-300"
          : "";
  const title =
    noteStatus === "failed"
      ? "Note not saved: close it or keep typing to try again"
      : noteStatus === "saving"
        ? "Saving the note…"
        : noteStatus === "unsaved"
          ? "Note edited"
          : hasNote
            ? "Note"
            : "Add a note";
  const statusText =
    noteStatus === "failed"
      ? "Not saved"
      : noteStatus === "saving"
        ? "Saving…"
        : noteStatus === "unsaved"
          ? "Edited"
          : hasNote
            ? "Saved"
            : "";
  const statusTone =
    noteStatus === "failed" ? "text-error-500" : noteStatus !== "saved" ? "text-warning-500" : "opacity-50";
  const headingText = active && noteStatus !== "saved" ? statusText : "";
  const headingTint = !active
    ? ""
    : noteStatus === "failed"
      ? "text-error-500 !opacity-100"
      : noteStatus !== "saved"
        ? "text-warning-500 !opacity-100"
        : "text-surface-900 dark:text-surface-50 !opacity-100";
  return { dot, title, statusText, statusTone, headingText, headingTint };
}

/** Presentation state for the 50/50 pane identifier bar directly above the editors. */
export function paneHeaderState({
  pane = null,
  requestBody = "",
  responseBody = "",
  metadataBody = null,
  hasResponse = false,
  hasNote = false,
  noteStatus = "saved",
} = {}) {
  const noteInfo = noteIndicator(noteStatus, hasNote);
  const copy =
    pane === "note"
      ? null
      : pane === "metadata"
        ? { kind: "metadata", label: "Copy metadata", actionId: null, disabled: metadataBody == null }
        : {
            kind: "response",
            label: "Copy response",
            actionId: `${DRAWER_CONTEXT}.copy-raw-response`,
            disabled: !hasResponse,
            disabledHint: "No response yet",
          };

  return {
    left: {
      label: "Request",
      sizeText: byteSizeText(requestBody),
      copy: {
        label: "Copy request",
        actionId: `${DRAWER_CONTEXT}.copy-raw-request`,
      },
    },
    right: {
      activePane: pane,
      tabs: [
        { id: null, label: "Response", actionId: null, dot: "", title: "Response" },
        { id: "note", label: "Note", actionId: `${DRAWER_CONTEXT}.view-note`, dot: noteInfo.dot, title: noteInfo.title },
        { id: "metadata", label: "Metadata", actionId: `${DRAWER_CONTEXT}.view-metadata`, dot: "", title: "Metadata" },
      ],
      metaText: pane === "note" ? noteInfo.statusText : pane === null ? byteSizeText(responseBody) : "",
      metaTone: pane === "note" ? noteInfo.statusTone : "opacity-45",
      copy,
    },
  };
}
