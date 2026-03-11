import { createAllowListGuard } from "../../../exposure/allowList";
import type { NodeExposurePolicySnapshot } from "../../../exposure/policy";

describe("allowList guard (open exposure override)", () => {
  const emptyPolicy: NodeExposurePolicySnapshot = {
    enabled: false,
    taskIds: [],
    eventIds: [],
    taskAllowAsyncContext: {},
    eventAllowAsyncContext: {},
    taskAsyncContextAllowList: {},
    eventAsyncContextAllowList: {},
  };

  it("returns null when open exposure is enabled without served rpc lanes", () => {
    const guard = createAllowListGuard(emptyPolicy, true);
    expect(guard.ensureTask("t")).toBeNull();
    expect(guard.ensureEvent("e")).toBeNull();
  });

  it("returns 403 when open exposure is disabled without served rpc lanes", () => {
    const guard = createAllowListGuard(emptyPolicy, false);
    const taskResponse = guard.ensureTask("t");
    const eventResponse = guard.ensureEvent("e");
    expect(taskResponse?.status).toBe(403);
    expect(eventResponse?.status).toBe(403);
  });

  it("uses served rpc lane ids for allow-list decisions", () => {
    const servedPolicy: NodeExposurePolicySnapshot = {
      enabled: true,
      taskIds: ["t"],
      eventIds: ["e"],
      taskAllowAsyncContext: {},
      eventAllowAsyncContext: {},
      taskAsyncContextAllowList: {},
      eventAsyncContextAllowList: {},
    };
    const guard = createAllowListGuard(servedPolicy, false);
    expect(guard.ensureTask("t")).toBeNull();
    expect(guard.ensureEvent("e")).toBeNull();
  });
});
