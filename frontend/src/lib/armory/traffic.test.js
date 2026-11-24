import { test } from "node:test";
import assert from "node:assert/strict";
import { grpcStatusText, groupLabel, isGrpcRun, shareText, stepRequest, trafficColumns } from "./traffic.js";

const rows = (n) => Array.from({ length: n }, (_, i) => ({ ID: `p${i}` }));

test("stepping from the open pair moves to its neighbour in the run's traffic", () => {
  assert.equal(stepRequest(rows(5), "p2", 1), 3);
  assert.equal(stepRequest(rows(5), "p2", -1), 1);
});

test("stepping stops at the run's first and last pairs", () => {
  assert.equal(stepRequest(rows(5), "p4", 1), -1);
  assert.equal(stepRequest(rows(5), "p0", -1), -1);
});

test("stepping matches ids whether they are numbers or strings", () => {
  assert.equal(stepRequest([{ ID: 7 }, { ID: 8 }], "7", 1), 1);
});

test("stepping from a pair the run no longer lists goes nowhere", () => {
  assert.equal(stepRequest(rows(5), "gone", 1), -1);
});

test("a group header names its value: the status code, the exact length, or … with no response", () => {
  assert.equal(groupLabel("status", "403"), "403");
  assert.equal(groupLabel("length", "1245"), "1,245 B");
  assert.equal(groupLabel("length", "0"), "0 B");
  assert.equal(groupLabel("status", ""), "…");
  assert.equal(groupLabel("length", ""), "…");
});

test("a group's share always has one decimal, so the decimal points line up", () => {
  assert.equal(shareText(50), "50.0%");
  assert.equal(shareText(100 / 3), "33.3%");
  assert.equal(shareText(0.04), "0.0%");
});

test("a gRPC run's table shows grpc-status after Status", () => {
  assert.deepEqual(trafficColumns(true).map((c) => c.label), ["#", "Time", "Method", "Host / Path", "Status", "gRPC status", "Length"]);
  assert.deepEqual(trafficColumns(false).map((c) => c.label), ["#", "Time", "Method", "Host / Path", "Status", "Length"]);
});

test("a grpc-status reads as its number and name", () => {
  assert.equal(grpcStatusText(0), "0 OK");
  assert.equal(grpcStatusText(3), "3 INVALID_ARGUMENT");
  assert.equal(grpcStatusText(16), "16 UNAUTHENTICATED");
  assert.equal(grpcStatusText(42), "42");
  assert.equal(grpcStatusText(null), "");
});

test("a run is gRPC when its template is gRPC or gRPC-Web, or a pair has a grpc-status", () => {
  assert.equal(isGrpcRun({ TemplateFraming: "grpc" }), true);
  assert.equal(isGrpcRun({ TemplateFraming: "grpc-web" }), true);
  assert.equal(isGrpcRun({ TemplateFraming: "connect" }), false);
  assert.equal(isGrpcRun({ TemplateFraming: "" }, [{ GrpcStatus: null }]), false);
  assert.equal(isGrpcRun({ TemplateFraming: "" }, [{ GrpcStatus: 0 }]), true);
});
