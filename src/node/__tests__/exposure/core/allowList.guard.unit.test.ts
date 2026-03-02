import type { Store } from "../../../../models/Store";
import { createAllowListGuard } from "../../../exposure/allowList";
import { globalTags } from "../../../../globals/globalTags";

describe("allowList guard (open exposure override)", () => {
  const store = {
    tasks: new Map([["t", { task: { id: "t" } }]]),
    events: new Map([["e", { event: { id: "e" } }]]),
    resources: new Map(),
    asyncContexts: new Map(),
    errors: new Map(),
  } as unknown as Store;

  it("returns null when open exposure is enabled without served rpc lanes", () => {
    const guard = createAllowListGuard(store, true);
    expect(guard.ensureTask("t")).toBeNull();
    expect(guard.ensureEvent("e")).toBeNull();
  });

  it("returns 403 when open exposure is disabled without served rpc lanes", () => {
    const guard = createAllowListGuard(store, false);
    const taskResponse = guard.ensureTask("t");
    const eventResponse = guard.ensureEvent("e");
    expect(taskResponse?.status).toBe(403);
    expect(eventResponse?.status).toBe(403);
  });

  it("uses served rpc lane ids for allow-list decisions", () => {
    const storeWithRpcAllowList = {
      tasks: new Map([["t", { task: { id: "t" } }]]),
      events: new Map([["e", { event: { id: "e" } }]]),
      resources: new Map([
        [
          "rpc",
          {
            resource: { id: "rpc", tags: [globalTags.rpcLanes] },
            value: {
              serveTaskIds: ["t"],
              serveEventIds: ["e"],
            },
          },
        ],
      ]),
      asyncContexts: new Map(),
      errors: new Map(),
    } as unknown as Store;

    const guard = createAllowListGuard(storeWithRpcAllowList, false);
    expect(guard.ensureTask("t")).toBeNull();
    expect(guard.ensureEvent("e")).toBeNull();
  });
});
