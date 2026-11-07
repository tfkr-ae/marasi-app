// boundAction: a user action's steps, bound to the connection it began on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { boundAction } from "./boundAction.js";
import { isSuperseded } from "./errors.js";

function link() {
  let live = true;
  return { live: () => live, move: () => (live = false) };
}

const rejection = (promise) =>
  promise.then(
    () => assert.fail("resolved"),
    (err) => err,
  );

test("steps run and resolve while the connection stays", async () => {
  const action = boundAction(link());
  assert.equal(await action.step(async () => 1), 1);
  assert.equal(await action.step(() => 2), 2);
});

test("a step after the client moved is superseded and never runs", async () => {
  const bound = link();
  const action = boundAction(bound);
  await action.step(async () => "first");
  bound.move();
  let ran = false;

  const err = await rejection(action.step(() => (ran = true)));

  assert.equal(isSuperseded(err), true);
  assert.equal(ran, false);
});

test("a step whose answer lands after the move is superseded, whatever it resolved or threw", async () => {
  const bound = link();
  const action = boundAction(bound);
  assert.equal(isSuperseded(await rejection(action.step(async () => (bound.move(), "late")))), true);

  const other = link();
  const failing = boundAction(other);
  const err = await rejection(
    failing.step(async () => {
      other.move();
      throw new Error("No Marasi connection is active.");
    }),
  );
  assert.equal(isSuperseded(err), true);
});

test("a step's own failure on a live connection goes on as it is", async () => {
  const action = boundAction(link());
  const err = await rejection(action.step(async () => Promise.reject(new Error("refused"))));
  assert.equal(err.message, "refused");
});

test("without a link (a fake client that can't bind) every step runs", async () => {
  const action = boundAction(undefined);
  assert.equal(action.live(), true);
  assert.equal(await action.step(() => "ran"), "ran");
});
