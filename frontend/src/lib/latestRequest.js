// A line of overlapping async requests where only the latest may act, such
// as right-clicks that each load before opening a menu.

/**
 * `start()` begins a request and supersedes every earlier one. It returns a
 * function that says whether that request is still the latest.
 */
export function latestRequest() {
  let latest = 0;
  return {
    start() {
      const token = ++latest;
      return () => token === latest;
    },
  };
}
