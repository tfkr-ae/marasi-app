// Gathers events that come fast, such as a live stream's messages, and
// hands them to `apply` together, in order, once `schedule` runs its
// callback: one store update for many events instead of one each.

/** The default schedule: about every 100 ms. */
export const every100ms = (run) => setTimeout(run, 100);

/** Returns push(event): queues the event for the next batch. */
export function eventBatch(apply, schedule = every100ms) {
  let queued = [];
  let scheduled = false;
  return (event) => {
    queued.push(event);
    if (scheduled) return;
    scheduled = true;
    schedule(() => {
      const events = queued;
      queued = [];
      scheduled = false;
      apply(events);
    });
  };
}
