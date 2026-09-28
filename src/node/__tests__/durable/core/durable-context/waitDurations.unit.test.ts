import { defineEvent } from "../../../../..";
import { DurableContext } from "../../../../durable/core/DurableContext";
import { WaitManager } from "../../../../durable/core/managers/WaitManager";
import { MemoryEventBus } from "../../../../durable/bus/MemoryEventBus";
import { MemoryStore } from "../../../../durable/store/MemoryStore";

const Paid = defineEvent<{ paidAt: number }>({ id: "paid" });

function createContext(store = new MemoryStore()) {
  return new DurableContext(store, new MemoryEventBus(), "e1", 1, {
    declaredSignalIds: new Set([Paid.id]),
  });
}

describe("durable: finite wait durations", () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, "1000" as any])(
    "rejects sleep(%p) without persisting timer state",
    async (durationMs) => {
      const store = new MemoryStore();
      const ctx = createContext(store);

      await expect(ctx.sleep(durationMs)).rejects.toThrow(
        "Invalid sleep duration: expected a finite number of milliseconds.",
      );
      expect(await store.getStepResult("e1", "__sleep:0")).toBeNull();
    },
  );

  it.each([Number.NaN, Number.NEGATIVE_INFINITY])(
    "rejects waitForSignal with timeoutMs %p",
    async (timeoutMs) => {
      const ctx = createContext();

      await expect(
        ctx.waitForSignal(Paid, { timeoutMs } as any),
      ).rejects.toThrow(
        "Invalid signal timeout: expected a finite number of milliseconds.",
      );
    },
  );

  it("rejects waitForExecution with a non-finite timeoutMs", async () => {
    const ctx = createContext();
    const child = { id: "child-task" } as any;

    await expect(
      ctx.waitForExecution(child, "e-child", {
        timeoutMs: Number.NaN,
      } as any),
    ).rejects.toThrow(
      "Invalid execution-wait timeout: expected a finite number of milliseconds.",
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects service wait with timeout %p",
    async (timeout) => {
      const manager = new WaitManager(new MemoryStore());

      await expect(
        manager.waitForResult("e1", { timeout } as any),
      ).rejects.toThrow(
        "Invalid wait timeout: expected a finite number of milliseconds.",
      );
    },
  );

  it("rejects service wait with a non-finite poll interval", async () => {
    const manager = new WaitManager(new MemoryStore());

    await expect(
      manager.waitForResult("e1", { waitPollIntervalMs: Number.NaN } as any),
    ).rejects.toThrow(
      "Invalid wait poll interval: expected a finite number of milliseconds.",
    );
  });
});
