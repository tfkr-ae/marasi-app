// A local connection's proxy port as the researcher types it: blank is any
// free port (0, as Go saves it), else a whole number 1–65535.

/** The typed port: 0 when blank, the number, or null when it isn't one. */
export function parsePort(text) {
  const trimmed = String(text ?? "").trim();
  if (trimmed === "") return 0;
  if (!/^\d+$/.test(trimmed)) return null;
  const port = Number(trimmed);
  return port >= 1 && port <= 65535 ? port : null;
}

/** A saved port as the field shows it: "" for any free port. */
export const portText = (port) => (port ? String(port) : "");

/** What a typed port that isn't one (parsePort's null) says. */
export const PORT_RANGE_MESSAGE = "Port is 1–65535, or blank for any";
