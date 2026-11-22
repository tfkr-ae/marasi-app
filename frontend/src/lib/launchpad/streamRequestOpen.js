// A streamed pair's request can't be launched while Marasi still carries it:
// GET /traffic/{id}/request/joined refuses with 409 stream_request_open
// until the request direction ends. The Launchpad store refuses a launch of
// such a request with the same code, and the page shows a short toast.

export const STREAM_REQUEST_OPEN = "stream_request_open";

/** The toast for a refused launch. */
export const STREAM_REQUEST_OPEN_TEXT = "Request still streaming";

/** True for Marasi's refusal, or the store's, of a still-streaming request. */
export const isStreamRequestOpen = (err) => err?.code === STREAM_REQUEST_OPEN;

/** The store's refusal to launch a request that is still streaming. */
export function streamRequestOpenError(id) {
  const err = new Error(`launch ${id}: ${STREAM_REQUEST_OPEN}: the request is still streaming`);
  err.code = STREAM_REQUEST_OPEN;
  return err;
}
