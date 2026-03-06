import * as nodeExports from "../../index";

describe("node index exports", () => {
  it("exports Node APIs and the full public surface", () => {
    expect((nodeExports as any).nodeExposure).toBeUndefined();
    expect((nodeExports as any).useExposureContext).toBeUndefined();
    expect((nodeExports as any).hasExposureContext).toBeUndefined();
    expect(typeof (nodeExports as any).run).toBe("function");
    expect(typeof (nodeExports as any).defineTag).toBe("function");
    expect(typeof (nodeExports as any).defineTask).toBe("function");
    expect(typeof (nodeExports as any).defineResource).toBe("function");
    expect(typeof (nodeExports as any).resources).toBe("object");
    expect(typeof (nodeExports as any).events).toBe("object");
    expect(typeof (nodeExports as any).middleware).toBe("object");
    expect(typeof (nodeExports as any).tags).toBe("object");
    expect(typeof (nodeExports as any).eventLanesResource).toBe("object");
    expect(typeof (nodeExports as any).rpcLanesResource).toBe("object");
    expect(typeof (nodeExports as any).useRpcLaneRequestContext).toBe(
      "function",
    );
    expect(typeof (nodeExports as any).hasRpcLaneRequestContext).toBe(
      "function",
    );
    expect(typeof (nodeExports as any).MemoryEventLaneQueue).toBe("function");
    expect(typeof (nodeExports as any).RabbitMQEventLaneQueue).toBe("function");
    expect((nodeExports as any).task).toBeUndefined();
    expect((nodeExports as any).resource).toBeUndefined();
    expect((nodeExports as any).tag).toBeUndefined();
  });

  it("re-exports createHttpSmartClient and is callable", () => {
    const fn = (nodeExports as any).createHttpSmartClient;
    expect(typeof fn).toBe("function");
    const client = fn({ baseUrl: "http://localhost:0" });
    expect(typeof client.task).toBe("function");
  });
});
