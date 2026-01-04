import { NoopEventBus } from "../bus/NoopEventBus";

describe("durable: NoopEventBus", () => {
  it("implements the bus contract as no-ops", async () => {
    const bus = new NoopEventBus();
    await bus.publish("chan", {
      type: "t",
      payload: null,
      timestamp: new Date(),
    });
    await bus.subscribe("chan", async () => {});
    await bus.unsubscribe("chan");
  });
});

describe("durable: index barrel", () => {
  it("loads via src/node/durable/index.ts", async () => {
    const durable = await import("../index");
    expect(typeof durable.DurableService).toBe("function");
    expect(typeof durable.durableResource).toBe("object");
    expect(durable.durableContext).toBeUndefined();

    for (const key of Object.keys(durable)) {
      void (durable as Record<string, unknown>)[key];
    }

    const core = await import("../core");
    expect(typeof core.DurableService).toBe("function");
    for (const key of Object.keys(core)) {
      void (core as Record<string, unknown>)[key];
    }
  });
});
