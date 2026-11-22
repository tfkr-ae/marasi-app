// The Messages modal table's sort: the # column sorts by message id, Dir by
// direction, either way; a sort of null keeps the kind's order. Ties keep
// the list's order.

const text = (value) => String(value ?? "").toLowerCase();
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** `messages` under `sorting` ({ id: "ID" | "Direction", desc } or null). */
export function sortMessages(messages, sorting, directionOf) {
  if (!sorting) return messages;
  const key = sorting.id === "Direction" ? (m) => text(directionOf(m)) : (m) => text(m.ID);
  const sign = sorting.desc ? -1 : 1;
  const keys = messages.map(key);
  // Messages usually come in id order: keep the list as it is.
  if (keys.every((k, i) => i === 0 || sign * compare(keys[i - 1], k) <= 0)) return messages;
  return messages
    .map((message, i) => i)
    .sort((a, b) => sign * compare(keys[a], keys[b]) || a - b)
    .map((i) => messages[i]);
}

/** A header click on `id`: ascending, then descending, then no sort. */
export function toggleSort(sorting, id) {
  if (sorting?.id !== id) return { id, desc: false };
  return sorting.desc ? null : { id, desc: true };
}
