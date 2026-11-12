// iOS: a swipe down closes the open sheet (a modal, a drawer, the Marasi
// menu, an expanded request), as on iOS's own sheets. The sheet follows the
// finger; let go far or fast enough and it closes the way Escape does
// (overlayIsolation.js), so a modal with unsaved edits still asks first and
// springs back. A swipe starts only where there is nothing above to scroll
// back to, and not inside an editor or a text field (but for the sheet's
// header), so it never fights a scroll or a selection.

const SHEETS = "dialog[open], .logbook-pair-expanded, .modal-backdrop, .drawer-backdrop";
const NO_SWIPE =
  "input, textarea, select, [contenteditable=''], [contenteditable='true'], .cm-editor, .monaco-editor, [data-no-swipe]";
const HEADER = 72; // px from the sheet's top where a swipe always starts
const DISTANCE = 110; // px down that closes
const FLICK = 0.5; // px/ms down that closes, past FLICK_MIN
const FLICK_MIN = 40;
const SPRING = "transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1)";

function scrolledDown(target, sheet) {
  for (let el = target; el && el !== sheet.parentElement; el = el.parentElement) {
    if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight) return true;
  }
  return false;
}

const same = (a, b) =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((value, i) => value === b[i]) : a === b;

/**
 * Starts listening; returns the function that stops.
 * `snapshot()` gives what is open, as a list (the modal store's top,
 * the drawer): when it changes after the Escape, the sheet closed.
 */
export function installSwipeToClose(snapshot = () => null) {
  let drag = null;

  function start(event) {
    drag = null;
    if (event.touches.length !== 1) return;
    const target = event.target;
    const sheet = target?.closest?.(SHEETS);
    if (!sheet) return;
    const touch = event.touches[0];
    const inHeader = touch.clientY - sheet.getBoundingClientRect().top < HEADER;
    if (!inHeader && (target.closest(NO_SWIPE) || scrolledDown(target, sheet))) return;
    drag = { sheet, x: touch.clientX, y: touch.clientY, t: event.timeStamp, dy: 0, v: 0, on: false };
  }

  // The sheet moves once a frame, on its own layer, however many touch
  // events arrive in between.
  let frame = 0;
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
    if (!frame) frame = requestAnimationFrame(paint);
  }

  function end() {
    const current = drag;
    drag = null;
    if (!current?.on) return;
    if (frame) cancelAnimationFrame(frame);
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
      setTimeout(settle, 260);
    };
    if (!(current.dy > DISTANCE || (current.dy > FLICK_MIN && current.v > FLICK))) return springBack();

    // Slide all the way out first, at the finger's speed, then close: the
    // modal's own closing fade then runs off screen instead of fighting
    // the slide. If the sheet stays open (it asks to keep edits, say), it
    // springs back up under its question.
    const rest = Math.max(window.innerHeight - current.dy, 0);
    const ms = Math.round(Math.min(260, Math.max(140, rest / Math.max(current.v, 1.2))));
    sheet.style.transition = `transform ${ms}ms cubic-bezier(0.3, 0.6, 0.4, 1)`;
    sheet.style.transform = "translate3d(0, 100%, 0)";
    const close = () => {
      const before = snapshot();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      // Closed: the sheet left, the dialog shut, or the store moved on (a
      // modal fading out is still in the page).
      requestAnimationFrame(() => {
        const closed =
          !sheet.isConnected || (sheet instanceof HTMLDialogElement && !sheet.open) || !same(snapshot(), before);
        if (!closed) return springBack();
        // A dialog stays in the page, shut: put it back for next time.
        if (sheet instanceof HTMLDialogElement) {
          sheet.style.transform = "";
          settle();
        }
      });
    };
    setTimeout(close, ms + 16);
  }

  document.addEventListener("touchstart", start, { passive: true });
  document.addEventListener("touchmove", move, { passive: false });
  document.addEventListener("touchend", end);
  document.addEventListener("touchcancel", end);
  return () => {
    document.removeEventListener("touchstart", start);
    document.removeEventListener("touchmove", move);
    document.removeEventListener("touchend", end);
    document.removeEventListener("touchcancel", end);
  };
}
