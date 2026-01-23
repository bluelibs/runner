import { DurableContext } from "../../durable/core/DurableContext";
import { MemoryEventBus } from "../../durable/bus/MemoryEventBus";
import { MemoryStore } from "../../durable/store/MemoryStore";

describe("durable: StepBuilder", () => {
  it("throws if awaited without up()", async () => {
    const ctx = new DurableContext(
      new MemoryStore(),
      new MemoryEventBus(),
      "e1",
      1,
    );
    await expect(ctx.step("s1").then()).rejects.toThrow("has no up()");
  });

  it("supports direct then() calls without handlers", async () => {
    const ctx = new DurableContext(
      new MemoryStore(),
      new MemoryEventBus(),
      "e1",
      1,
    );
    const builder = ctx.step<string>("s1").up(async () => "ok");
    await expect(builder.then()).resolves.toBe("ok");
  });

  it("propagates errors when onrejected is not provided", async () => {
    const ctx = new DurableContext(
      new MemoryStore(),
      new MemoryEventBus(),
      "e1",
      1,
    );
    const builder = ctx.step("s1").up(async () => {
      throw new Error("boom");
    });
    await expect(builder.then()).rejects.toThrow("boom");
  });
});
