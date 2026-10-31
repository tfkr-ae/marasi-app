import assert from "node:assert/strict";
import { test } from "node:test";
import { isUpdateForNightly, nightlyCommit, parseNightlyVersion, parseReleaseVersion, releaseNewerThan, releaseUpdatesNightly } from "./version.js";

const release = (tag) => parseReleaseVersion(tag);

test("a later release date or a later same-day re-release is newer", () => {
  assert.equal(releaseNewerThan(release("18.10.2026"), release("17.10.2026")), true);
  assert.equal(releaseNewerThan(release("17.10.2026-1"), release("17.10.2026")), true);
  assert.equal(releaseNewerThan(release("17.10.2026-10"), release("17.10.2026-2")), true);
  assert.equal(releaseNewerThan(release("17.10.2026"), release("17.10.2026")), false);
  assert.equal(releaseNewerThan(release("01.01.2027"), release("31.12.2026-9")), true);
});

test("only DD.MM.YYYY with an optional suffix is a release version", () => {
  for (const bad of ["17.10.26", "2026-10-17", "17.10.2026-", "32.10.2026", "v17.10.2026", ""]) {
    assert.equal(parseReleaseVersion(bad), null, bad);
  }
});

test("a nightly version names its line, so a v2 nightly never reads as a v1 nightly", () => {
  assert.deepEqual(parseNightlyVersion("17.10.2026 (nightly abc1234)", "nightly")?.commit, "abc1234");
  assert.equal(parseNightlyVersion("17.10.2026 (nightly abc1234)", "v2-nightly"), null);
  assert.equal(parseNightlyVersion("17.10.2026 (v2-nightly abc1234)", "nightly"), null);
  assert.equal(parseNightlyVersion("17.10.2026 (v2-nightly abc1234)", "v2-nightly")?.commit, "abc1234");
  assert.equal(parseNightlyVersion("17.10.2026 (v2-nightly xyz)", "v2-nightly"), null);
});

test("a published nightly is an update from another commit dated on or after the running one", () => {
  const running = parseNightlyVersion("17.10.2026 (nightly abc1234)", "nightly");
  const at = (version, commit) => ({ ...parseNightlyVersion(version, "nightly"), commit });
  assert.equal(isUpdateForNightly(at("17.10.2026 (nightly def5678)", "def5678aaaa"), running), true);
  assert.equal(isUpdateForNightly(at("17.10.2026 (nightly abc1234)", "ABC1234ffff"), running), false);
  assert.equal(isUpdateForNightly(at("16.10.2026 (nightly def5678)", "def5678"), running), false);
  // A release switched to nightly has no commit and is ordered by date.
  assert.equal(isUpdateForNightly(at("17.10.2026 (nightly abc1234)", "abc1234"), { date: running.date, commit: "" }), true);
});

test("a release updates a running nightly only when dated after it", () => {
  const running = parseNightlyVersion("17.10.2026 (nightly abc1234)", "nightly");
  assert.equal(releaseUpdatesNightly(release("17.10.2026-1"), running), false);
  assert.equal(releaseUpdatesNightly(release("18.10.2026"), running), true);
});

test("the commit comes from the Commit line of a nightly's notes", () => {
  assert.equal(nightlyCommit("- fix a thing\n\nRef: v2\nCommit: 0123456789abcdef\nMarasi: ff\n"), "0123456789abcdef");
  assert.equal(nightlyCommit("Commit: not-a-hash"), null);
  assert.equal(nightlyCommit("- no commit line"), null);
});
