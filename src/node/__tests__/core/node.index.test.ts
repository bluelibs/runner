import * as nodeExports from "../../index";

describe("node index exports", () => {
  it("exports Node APIs and the full public surface", () => {
    expect((nodeExports as any).nodeExposure).toBeUndefined();
    expect(typeof (nodeExports as any).run).toBe("function");
    expect(typeof (nodeExports as any).tag).toBe("function");
    expect(typeof (nodeExports as any).task).toBe("function");
    expect(typeof (nodeExports as any).resource).toBe("function");
    expect(typeof (nodeExports as any).eventLanesResource).toBe("object");
    expect(typeof (nodeExports as any).rpcLanesResource).toBe("object");
    expect(typeof (nodeExports as any).MemoryEventLaneQueue).toBe("function");
    expect(typeof (nodeExports as any).RabbitMQEventLaneQueue).toBe("function");
  });

  it("re-exports createHttpSmartClient and is callable", () => {
    const fn = (nodeExports as any).createHttpSmartClient;
    expect(typeof fn).toBe("function");
    const client = fn({ baseUrl: "http://localhost:0" });
    expect(typeof client.task).toBe("function");
  });
});
