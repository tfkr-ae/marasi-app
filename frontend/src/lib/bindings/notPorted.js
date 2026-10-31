// v2 replaces each Wails binding with a call to the connection's control
// API, one ticket at a time. Until a binding is ported, it rejects with a
// NotPorted error, so a page shows a short toast or an empty state instead
// of breaking.

/** A not ported error's text, as String(error) shows it. */
export const notPortedText = "not ported";

/** The error a binding that isn't ported yet rejects with. */
export class NotPorted extends Error {
  constructor(binding) {
    super(`${binding} is not ported`);
    this.name = "NotPorted";
    this.binding = binding;
  }

  // The app's error helpers show String(error), as Wails rejected with text.
  toString() {
    return notPortedText;
  }
}

/** Whether `error` is a binding's not ported rejection. */
export function isNotPorted(error) {
  return error instanceof NotPorted;
}

/** A binding named `binding` that always rejects with NotPorted. */
export function notPorted(binding) {
  return () => Promise.reject(new NotPorted(binding));
}
