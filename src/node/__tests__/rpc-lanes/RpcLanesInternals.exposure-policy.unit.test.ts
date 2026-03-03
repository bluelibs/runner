import {
  toRpcLanesExposurePolicy,
  type RpcLaneResolvedState,
} from "../../rpc-lanes/RpcLanesInternals";

function createResolvedState(
  partial: Partial<RpcLaneResolvedState>,
): RpcLaneResolvedState {
  return {
    profile: "tests.profile",
    mode: "network",
    serveLaneIds: new Set(),
    bindingsByLaneId: new Map(),
    taskLaneByTaskId: new Map(),
    eventLaneByEventId: new Map(),
    serveTaskIds: new Set(),
    serveEventIds: new Set(),
    taskAllowAsyncContext: new Map(),
    eventAllowAsyncContext: new Map(),
    taskAsyncContextAllowList: new Map(),
    eventAsyncContextAllowList: new Map(),
    communicatorByLaneId: new Map(),
    ...partial,
  };
}

describe("toRpcLanesExposurePolicy", () => {
  it("returns disabled policy when no served endpoints exist", () => {
    const resolved = createResolvedState({
      taskAllowAsyncContext: new Map([["task.a", false]]),
      eventAllowAsyncContext: new Map([["event.a", true]]),
      taskAsyncContextAllowList: new Map([
        ["task.a", undefined],
        ["task.b", ["ctx.allowed"]],
      ]),
      eventAsyncContextAllowList: new Map([
        ["event.a", undefined],
        ["event.b", ["ctx.allowed.event"]],
      ]),
    });

    const policy = toRpcLanesExposurePolicy(resolved);
    expect(policy.enabled).toBe(false);
    expect(policy.taskIds).toEqual([]);
    expect(policy.eventIds).toEqual([]);
    expect(policy.taskAsyncContextAllowList).toEqual({
      "task.b": ["ctx.allowed"],
    });
    expect(policy.eventAsyncContextAllowList).toEqual({
      "event.b": ["ctx.allowed.event"],
    });
  });

  it("returns enabled policy when served task/event ids exist", () => {
    const resolved = createResolvedState({
      serveTaskIds: new Set(["task.served"]),
      serveEventIds: new Set(["event.served"]),
    });

    const policy = toRpcLanesExposurePolicy(resolved);
    expect(policy.enabled).toBe(true);
    expect(policy.taskIds).toEqual(["task.served"]);
    expect(policy.eventIds).toEqual(["event.served"]);
  });
});
