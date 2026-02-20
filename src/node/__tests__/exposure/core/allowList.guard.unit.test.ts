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

  it("reports selector failures through injected logger", () => {
    const warn = jest.fn();
    const storeWithThrowingSelector = {
      tasks: new Map([["t", { task: { id: "t" } }]]),
      events: new Map(),
      resources: new Map([
        [
          "srv",
          {
            resource: { id: "srv", tags: [globalTags.tunnel] },
            value: {
              mode: "server",
              transport: "http",
              tasks: () => {
                throw new Error("selector boom");
              },
            },
          },
        ],
      ]),
      asyncContexts: new Map(),
      errors: new Map(),
    } as unknown as Store;

    const guard = createAllowListGuard(storeWithThrowingSelector, false, {
      warn,
    } as any);
    guard.ensureTask("t");
    expect(warn).toHaveBeenCalledWith(
      "[runner] Tunnel allow-list selector failed; item skipped.",
      expect.objectContaining({
        error: expect.any(Error),
        data: expect.objectContaining({
          selectorKind: "task",
          candidateId: "t",
          tunnelResourceId: "srv",
        }),
      }),
    );
  });

  it("keeps running when selector fails and no logger is provided", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const storeWithThrowingSelector = {
      tasks: new Map([["t", { task: { id: "t" } }]]),
      events: new Map(),
      resources: new Map([
        [
          "srv",
          {
            resource: { id: "srv", tags: [globalTags.tunnel] },
            value: {
              mode: "server",
              transport: "http",
              tasks: () => {
                throw new Error("selector boom");
              },
            },
          },
        ],
      ]),
      asyncContexts: new Map(),
      errors: new Map(),
    } as unknown as Store;

    try {
      const guard = createAllowListGuard(storeWithThrowingSelector, false);
      expect(() => guard.ensureTask("t")).not.toThrow();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
