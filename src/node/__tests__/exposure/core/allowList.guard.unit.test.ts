import { createAllowListGuard } from "../../../exposure/allowList";
import type { NodeExposurePolicySnapshot } from "../../../exposure/policy";

describe("allowList guard", () => {
  const emptyPolicy: NodeExposurePolicySnapshot = {
    enabled: false,
    taskIds: [],
    eventIds: [],
    taskAllowAsyncContext: {},
    eventAllowAsyncContext: {},
    taskAsyncContextAllowList: {},
    eventAsyncContextAllowList: {},
  };

  it("returns 403 when no allow-list source is active", () => {
    const guard = createAllowListGuard(emptyPolicy);
    const taskResponse = guard.ensureTask("t");
    const eventResponse = guard.ensureEvent("e");
    expect(taskResponse?.status).toBe(403);
    expect(taskResponse?.body).toEqual({
      ok: false,
      error: {
        code: "FORBIDDEN",
        message: "Exposure not enabled",
      },
    });
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
    const guard = createAllowListGuard(servedPolicy);
    expect(guard.ensureTask("t")).toBeNull();
    expect(guard.ensureEvent("e")).toBeNull();
  });
});
