import { test } from "node:test";
import assert from "node:assert/strict";
import { connectionsView, rectMoved, scanErrorText, scanRect } from "./pairing-view.js";

const local = { id: "local", kind: "local", name: "Local" };
const lab = { id: "lab", kind: "remote", name: "Lab", url: "http://10.0.0.5:9000" };

test("the desktop modal lists every connection and shows the picked one", () => {
  const view = connectionsView({ mobile: false, connections: [local, lab], picked: "lab" });
  assert.deepEqual(view, { listed: [local, lab], showList: true, pane: "detail", connection: lab });
});

test("the desktop modal falls back to the first connection, and shows the add form for add", () => {
  assert.equal(connectionsView({ mobile: false, connections: [local, lab], picked: "gone" }).connection, local);
  assert.equal(connectionsView({ mobile: false, connections: [local, lab], picked: "add" }).pane, "add");
});

test("on iOS with no remote the modal is only the scanner", () => {
  const view = connectionsView({ mobile: true, connections: [local], picked: "local" });
  assert.deepEqual(view, { listed: [], showList: false, pane: "pair", connection: null });
});

test("on iOS the modal lists the remotes and never Local", () => {
  const view = connectionsView({ mobile: true, connections: [local, lab], picked: "lab" });
  assert.deepEqual(view, { listed: [lab], showList: true, pane: "detail", connection: lab });
});

test("on iOS picking add, or still being on Local, shows the scanner", () => {
  assert.equal(connectionsView({ mobile: true, connections: [local, lab], picked: "add" }).pane, "pair");
  assert.equal(connectionsView({ mobile: true, connections: [local, lab], picked: "local" }).pane, "pair");
});

test("each scanner failure has its line, and an unknown one names itself", () => {
  assert.match(scanErrorText("camera-denied"), /Allow it in Settings/);
  assert.match(scanErrorText("no-camera"), /No camera found/);
  assert.match(scanErrorText("camera-failed"), /didn't start/);
  assert.equal(scanErrorText("odd"), "The camera didn't start (odd).");
});

test("the scan box comes from a DOMRect and moves only by half a pixel or more", () => {
  const box = scanRect({ left: 10, top: 20, width: 300, height: 200 });
  assert.deepEqual(box, { x: 10, y: 20, width: 300, height: 200 });
  assert.equal(rectMoved(null, box), true);
  assert.equal(rectMoved(box, { ...box, x: 10.2 }), false);
  assert.equal(rectMoved(box, { ...box, height: 201 }), true);
});
