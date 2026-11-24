// Presentation helpers for the Connection details layout (ConnectionDetail.svelte):
// identity header metadata, inline stop confirmation copy, and collapsed setup
// disclosure header.

/** Host, instance, and OS metadata line under the connection name. */
export function detailWhereText(connection, { instance = null, os = null } = {}) {
  const host =
    connection.kind === "local" ? "This machine" : (connection.url?.replace(/^https?:\/\//, "") ?? "");
  const inst = instance || (connection.kind === "local" ? connection.instance : null) || null;
  return [host, inst ? `instance ${inst}` : null, os || null].filter(Boolean).join(" · ");
}

/** Service version, build channel, and API level line, or null before reaching a service. */
export function serviceMetaText({ version = null, channel = null, api = null } = {}) {
  if (!version) return null;
  const hasChannel = channel && version.toLowerCase().includes(`(${channel.toLowerCase()}`);
  const ch = channel && !hasChannel ? ` (${channel})` : "";
  return `Marasi ${version}${ch} · API ${api ?? "none"}`;
}

/** Concise inline Stop confirmation copy for the contextual slot. */
export function stopConfirmCopy(connection) {
  return {
    title: `Stop ${connection.name}?`,
    detail:
      connection.kind === "remote"
        ? "You'll need to start it again on the remote host."
        : "Another program started this instance.",
  };
}

/** Concise inline Restart confirmation copy for remote or unowned local runs. */
export function restartConfirmCopy(connection) {
  return {
    title: `Restart ${connection.name}?`,
    detail: "Active connections will drop while the project reopens.",
  };
}

/** Collapsed setup disclosure heading and mono summary. */
export function setupDisclosure(connection, { channel = null, version = null, mobile = false } = {}) {
  const title =
    connection.kind === "remote" || mobile ? "Update channel & reinstall" : "Channel, CLI path & quit behavior";
  const summary = channel || (version === "dev" ? "dev" : "");
  return { title, summary };
}
