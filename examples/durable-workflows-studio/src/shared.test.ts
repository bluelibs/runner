import test from "node:test";
import assert from "node:assert/strict";
import {
  EXECUTION_STATUS_META,
  NODE_KIND_META,
  NODE_STATE_META,
  isAttentionState,
  isLiveStatus,
} from "./shared/statuses.js";

test("execution statuses cover the full engine lifecycle", () => {
  assert.deepEqual(Object.keys(EXECUTION_STATUS_META).sort(), [
    "cancelled",
    "cancelling",
    "compensation_failed",
    "completed",
    "failed",
    "pending",
    "retrying",
    "running",
    "sleeping",
  ]);
  for (const meta of Object.values(EXECUTION_STATUS_META)) {
    assert.ok(meta.label.length > 0);
    assert.ok(meta.tone.length > 0);
  }
});

test("live statuses exclude only terminal states", () => {
  assert.equal(isLiveStatus("running"), true);
  assert.equal(isLiveStatus("sleeping"), true);
  assert.equal(isLiveStatus("pending"), true);
  assert.equal(isLiveStatus("retrying"), true);
  assert.equal(isLiveStatus("cancelling"), true);
  assert.equal(isLiveStatus("completed"), false);
  assert.equal(isLiveStatus("failed"), false);
  assert.equal(isLiveStatus("cancelled"), false);
  assert.equal(isLiveStatus("compensation_failed"), false);
});

test("node states flag exactly the attention-needing ones", () => {
  assert.deepEqual(Object.keys(NODE_STATE_META).sort(), [
    "active",
    "completed",
    "failed",
    "pending",
    "skipped",
    "unreached",
    "waiting",
  ]);
  assert.equal(isAttentionState("active"), true);
  assert.equal(isAttentionState("waiting"), true);
  assert.equal(isAttentionState("failed"), true);
  assert.equal(isAttentionState("completed"), false);
  assert.equal(isAttentionState("pending"), false);
  assert.equal(isAttentionState("skipped"), false);
  assert.equal(isAttentionState("unreached"), false);
});

test("node kinds are all labelled", () => {
  assert.deepEqual(Object.keys(NODE_KIND_META).sort(), [
    "child",
    "note",
    "signal",
    "sleep",
    "step",
    "switch",
  ]);
});
