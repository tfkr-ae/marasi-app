// Mobile: a swipe down closes the open sheet (a modal, a drawer, the Marasi
// menu, an expanded request), as on iOS's own sheets. The sheet follows the
// finger; let go far or fast enough and it slides out, then closes the way
// Escape does (closeTopOverlay in overlayIsolation.js), so a modal with
// unsaved edits still asks first and springs back. A swipe starts only
// where there is nothing above to scroll back to, and not inside an editor
// or a text field (but for the sheet's header), so it never fights a
// scroll or a selection.

export const SHEETS = "dialog[open], .logbook-pair-expanded, .modal-backdrop, .drawer-backdrop";
const NO_SWIPE =
  "input, textarea, select, [contenteditable=''], [contenteditable='true'], .cm-editor, .monaco-editor, [data-no-swipe]";
export const HEADER_PX = 72; // from the sheet's top, where a swipe always starts
export const CLOSE_PX = 110; // down, that closes
export const FLICK = 0.5; // px/ms down that closes, past FLICK_MIN_PX
export const FLICK_MIN_PX = 40;
export const SPRING_MS = 240;
const SPRING = `transform ${SPRING_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;

/** Whether a drag let go at `dy` px, moving at `v` px/ms, closes the sheet. */
export function closesAt(dy, v) {
  return dy > CLOSE_PX || (dy > FLICK_MIN_PX && v > FLICK);
}

/** How long the slide out takes: the finger's speed, within bounds. */
export function slideOutMs(rest, v) {
  return Math.round(Math.min(260, Math.max(140, rest / Math.max(v, 1.2))));
}

function scrolledDown(target, sheet) {
  for (let el = target; el && el !== sheet.parentElement; el = el.parentElement) {
    if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight) return true;
  }
  return false;
}

const isDialog = (sheet) => sheet.tagName === "DIALOG";

const browserTime = {
  frame: (fn) => requestAnimationFrame(fn),
  cancelFrame: (id) => cancelAnimationFrame(id),
  later: (fn, ms) => setTimeout(fn, ms),
};

/**
 * Starts listening on `root` (the document); returns the function that stops.
 * - `close()` asks the top sheet to close (closeTopOverlay).
 * - `snapshot()` gives what is open, as a list (the modal store's top, the
 *   drawer): when it changes after `close()`, the sheet closed.
 * - `height()` is the screen's height; `time` its frames and timers.
 */
export function installSwipeToClose(
  root,
  { close, snapshot = () => [], height = () => window.innerHeight, time = browserTime } = {},
) {
  let drag = null;
  let frame = 0;

  function start(event) {
    drag = null;
    if (event.touches.length !== 1) return;
    const target = event.target;
    const sheet = target?.closest?.(SHEETS);
    if (!sheet) return;
    const touch = event.touches[0];
    const inHeader = touch.clientY - sheet.getBoundingClientRect().top < HEADER_PX;
    if (!inHeader && (target.closest(NO_SWIPE) || scrolledDown(target, sheet))) return;
    drag = { sheet, x: touch.clientX, y: touch.clientY, t: event.timeStamp, dy: 0, v: 0, on: false };
  }

  // The sheet moves once a frame, on its own layer, however many touch
  // events arrive in between.
  const paint = () => {
    frame = 0;
    if (drag?.on) drag.sheet.style.transform = `translate3d(0, ${drag.dy}px, 0)`;
  };

  function move(event) {
    if (!drag) return;
    const touch = event.touches[0];
    const dx = touch.clientX - drag.x;
    const dy = touch.clientY - drag.y;
    if (!drag.on) {
      // Decided on the first move, before the page starts a scroll of its
      // own: once WebKit scrolls, it sends touches late and in bursts, and
      // the content bounces under the finger. Sideways or up is a scroll
      // or a selection, not ours.
      if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) {
        drag = null;
        return;
      }
      drag.on = true;
      drag.sheet.style.transition = "none";
      drag.sheet.style.willChange = "transform";
    }
    event.preventDefault();
    const dt = Math.max(event.timeStamp - drag.t, 1);
    const next = Math.max(dy, 0);
    // Velocity, smoothed over the last few moves so one late event does
    // not decide a flick.
    drag.v = drag.v * 0.6 + ((next - drag.dy) / dt) * 0.4;
    drag.t = event.timeStamp;
    drag.dy = next;
    if (!frame) frame = time.frame(paint);
  }

  function end() {
    const current = drag;
    drag = null;
    if (!current?.on) return;
    if (frame) time.cancelFrame(frame);
    frame = 0;
    const { sheet } = current;
    const settle = () => {
      sheet.style.transition = "";
      sheet.style.willChange = "";
    };
    const springBack = () => {
      sheet.style.transition = SPRING;
      sheet.style.transform = "";
      // A timer, not transitionend: a child's transition bubbles up too.
      time.later(settle, SPRING_MS + 20);
    };
    if (!closesAt(current.dy, current.v)) return springBack();

    // Slide all the way out first, at the finger's speed, then close: the
    // modal's own closing fade then runs off screen instead of fighting
    // the slide. If the sheet stays open (it asks to keep edits, say), it
    // springs back up under its question.
    const ms = slideOutMs(Math.max(height() - current.dy, 0), current.v);
    sheet.style.transition = `transform ${ms}ms cubic-bezier(0.3, 0.6, 0.4, 1)`;
    sheet.style.transform = "translate3d(0, 100%, 0)";
    time.later(() => {
      const before = snapshot();
      close();
      // Closed: the sheet left, the dialog shut, or the store moved on (a
      // modal fading out is still in the page).
      time.frame(() => {
        const after = snapshot();
        const moved = after.length !== before.length || after.some((value, i) => value !== before[i]);
        const closed = !sheet.isConnected || (isDialog(sheet) && !sheet.open) || moved;
        if (!closed) return springBack();
        // A dialog stays in the page, shut: put it back for next time.
        // (A modal on its way out keeps going down.)
        if (isDialog(sheet)) {
          sheet.style.transform = "";
          settle();
        }
      });
    }, ms + 16);
  }

  root.addEventListener("touchstart", start, { passive: true });
  root.addEventListener("touchmove", move, { passive: false });
  root.addEventListener("touchend", end);
  root.addEventListener("touchcancel", end);
  return () => {
    root.removeEventListener("touchstart", start);
    root.removeEventListener("touchmove", move);
    root.removeEventListener("touchend", end);
    root.removeEventListener("touchcancel", end);
  };
}
