import { NoopEventBus } from "../../durable/bus/NoopEventBus";
import * as durable from "../../durable/index";
import * as core from "../../durable/core";

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
  it("loads via src/node/durable/index.ts", () => {
    expect(typeof durable.DurableService).toBe("function");
    expect(typeof durable.durableResource).toBe("object");
    expect((durable as Record<string, unknown>).durableContext).toBeUndefined();

    for (const key of Object.keys(durable)) {
      void (durable as Record<string, unknown>)[key];
    }

    expect(typeof core.DurableService).toBe("function");
    for (const key of Object.keys(core)) {
      void (core as Record<string, unknown>)[key];
    }
  });
});
