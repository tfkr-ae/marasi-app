// The evidence list's rows for a record's linked pairs: number, method, host
// and path, and status. The saved links come from one traffic query
// (finding = "<id>" or test_case = "<id>"), read without their bodies; a pair
// that query doesn't list, such as a link staged in an edit, is read on its
// own, a few at a time. Only the viewer reads a pair in full.

/** How many pairs the list reads on their own at once. */
export const ROW_READS_AT_ONCE = 4;

/** A traffic row as the part of a full pair the list shows. */
export function rowAsPair(row) {
  return {
    Request: { Number: row.Number, Method: row.Method, Host: row.Host, Path: row.Path },
    Response: { StatusCode: row.StatusCode },
  };
}

/**
 * `listLinked()` resolves to the saved links' traffic rows ([] for an unsaved
 * record); `readPair(id)` reads one pair in full. Returns `row(id)`, which
 * resolves to a pair-shaped row, or null when the pair is gone. Each id is
 * read once.
 */
export function createPairRows({ listLinked, readPair, concurrency = ROW_READS_AT_ONCE }) {
  const listed = Promise.resolve()
    .then(listLinked)
    .then((rows) => new Map((rows ?? []).map((row) => [String(row.ID), rowAsPair(row)])))
    .catch((err) => {
      console.error("Listing the linked requests failed:", err);
      return new Map();
    });

  let active = 0;
  const waiting = [];
  function limited(read) {
    return new Promise((resolve, reject) => {
      const start = () => {
        active++;
        read()
          .then(resolve, reject)
          .finally(() => {
            active--;
            waiting.shift()?.();
          });
      };
      if (active < concurrency) start();
      else waiting.push(start);
    });
  }

  const rows = new Map();
  return function row(id) {
    const key = String(id);
    if (!rows.has(key)) {
      rows.set(
        key,
        listed.then((map) => map.get(key) ?? limited(() => readPair(id))).catch(() => null),
      );
    }
    return rows.get(key);
  };
}
