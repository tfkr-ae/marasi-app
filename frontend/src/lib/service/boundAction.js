// A user action of several service calls, bound to the connection it began
// on. Capture it when the action starts, from the store's api:
//
//   const action = boundAction(api.bind?.());   // a client.bind() (client.js)
//   const id = await action.step(() => api.create(...));
//   await action.step(() => api.link(id, ...));
//
// step(fn) refuses to start once the client has moved to another
// connection, and an answer (or failure) that lands after the move rejects
// too, both with a superseded ServiceError (isSuperseded in errors.js): the
// action stops there, quietly. `fn` sends its request before its first
// await, as the client's calls do, so a step that starts live goes to the
// action's connection. Without a link (a fake client) every step runs.
import { superseded } from "./errors.js";

export function boundAction(link) {
  const live = () => link?.live() ?? true;
  return {
    live,
    async step(fn) {
      if (!live()) throw superseded("a step of an action");
      let result;
      try {
        result = await fn();
      } catch (err) {
        if (!live()) throw superseded("a step of an action");
        throw err;
      }
      if (!live()) throw superseded("a step of an action");
      return result;
    },
  };
}
