import type { Store } from "../../../models/Store";
import { createAllowListGuard } from "../../exposure/allowList";

describe("allowList guard (open exposure override)", () => {
  const store = {
    tasks: new Map([["t", { task: { id: "t" } }]]),
    events: new Map([["e", { event: { id: "e" } }]]),
    resources: new Map(),
    asyncContexts: new Map(),
    errors: new Map(),
  } as unknown as Store;

  it("returns null when open exposure is enabled without server tunnels", () => {
    const guard = createAllowListGuard(store, true);
    expect(guard.ensureTask("t")).toBeNull();
    expect(guard.ensureEvent("e")).toBeNull();
  });

  it("returns 403 when open exposure is disabled without server tunnels", () => {
    const guard = createAllowListGuard(store, false);
    const taskResponse = guard.ensureTask("t");
    const eventResponse = guard.ensureEvent("e");
    expect(taskResponse?.status).toBe(403);
    expect(eventResponse?.status).toBe(403);
  });
});
