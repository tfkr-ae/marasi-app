// An EventSource-like reader of a Server-Sent Events stream over `fetch`, so
// it can send `Authorization: Bearer`, which a native EventSource can't.
//
//   const EventSource = createFetchEventSource(fetch);
//   const source = new EventSource(url, { headers });
//   source.onopen = () => …;          // the service answered 2xx
//   source.onerror = ({ status }) => …; // refused (status set), failed or ended
//   source.addEventListener("log.added", ({ type, data }) => …); // data: text
//   source.close();                   // stops, with no onerror
//
// It never reconnects: onerror fires once and the source is closed. It reads
// `event:` and `data:` lines, dispatches on a blank line, and skips comments
// (`: connected`, `: heartbeat`); Marasi sends no `id:` or `retry:`.

export function createFetchEventSource(fetch) {
  return class FetchEventSource {
    constructor(url, { headers = {} } = {}) {
      this.url = url;
      this.onopen = null;
      this.onerror = null;
      this.listeners = new Map();
      this.closed = false;
      this.abort = new AbortController();
      this.run(headers);
    }

    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(listener);
    }

    removeEventListener(type, listener) {
      this.listeners.get(type)?.delete(listener);
    }

    close() {
      if (this.closed) return;
      this.closed = true;
      this.abort.abort();
    }

    fail(status = null) {
      if (this.closed) return;
      this.closed = true;
      this.abort.abort();
      this.onerror?.({ type: "error", status });
    }

    dispatch(type, data) {
      for (const listener of this.listeners.get(type) ?? []) listener({ type, data });
    }

    async run(headers) {
      let response;
      try {
        response = await fetch(this.url, {
          headers: { Accept: "text/event-stream", ...headers },
          signal: this.abort.signal,
          cache: "no-store",
        });
      } catch {
        this.fail();
        return;
      }
      if (this.closed) return;
      if (!response.ok || !response.body) {
        this.fail(response.status);
        return;
      }
      this.onopen?.({ type: "open" });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let type = "message";
      let data = [];
      try {
        while (!this.closed) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline;
          while ((newline = buffer.search(/\r\n|\r|\n/)) >= 0) {
            // A trailing \r may be the first half of a \r\n split across chunks.
            if (newline === buffer.length - 1 && buffer.endsWith("\r")) break;
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + (buffer.startsWith("\r\n", newline) ? 2 : 1));
            if (line === "") {
              if (data.length) this.dispatch(type, data.join("\n"));
              type = "message";
              data = [];
              continue;
            }
            if (line.startsWith(":")) continue;
            const colon = line.indexOf(":");
            const field = colon < 0 ? line : line.slice(0, colon);
            const raw = colon < 0 ? "" : line.slice(colon + 1);
            const fieldValue = raw.startsWith(" ") ? raw.slice(1) : raw;
            if (field === "event") type = fieldValue;
            else if (field === "data") data.push(fieldValue);
          }
        }
      } catch {
        // A network failure or close(): fail() reports only the former.
      }
      this.fail();
    }
  };
}
