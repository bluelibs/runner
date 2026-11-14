import { commandFixture } from "./command.helpers";
import { MemoryEventBus } from "../../../../durable/bus/MemoryEventBus";

describe("command receipt waiting", () => {
  it("cleans up a subscription that becomes live after the caller timed out", async () => {
    jest.useFakeTimers();
    try {
      const f = await commandFixture();
      const bus = new MemoryEventBus();
      f.config.eventBus = bus;
      f.kickoff.mockResolvedValue(undefined);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const subscribe = bus.subscribe.bind(bus);
      jest
        .spyOn(bus, "subscribe")
        .mockImplementation(async (channel, handler) => {
          await gate;
          await subscribe(channel, handler);
        });
      const outcome = f.manager
        .command("run", f.command, 1, {
          idempotencyKey: "late",
          waitTimeoutMs: 20,
        })
        .catch((error: unknown) => error);
      await jest.advanceTimersByTimeAsync(20);
      expect(await outcome).toMatchObject({
        message: expect.stringContaining("wait timed out"),
      });
      release();
      await jest.advanceTimersByTimeAsync(0);
      const read = jest.spyOn(f.store, "getCommand");
      await bus.publish(
        `command:${JSON.stringify(["run", f.command.id, "late"])}`,
        { type: "finished", payload: null, timestamp: new Date() },
      );
      expect(read).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("uses committed receipt notifications without waiting for a poll", async () => {
    const f = await commandFixture();
    const bus = new MemoryEventBus();
    f.config.eventBus = bus;
    const subscribe = jest.spyOn(bus, "subscribe");
    const unsubscribe = jest.spyOn(bus, "unsubscribe");
    f.kickoff.mockResolvedValue(undefined);
    const waiting = f.manager.command("run", f.command, 1);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(subscribe).toHaveBeenCalledTimes(1);
    const read = jest.spyOn(f.store, "getCommand");
    await f.manager.drain(f.execution, f.workflow, f.store, f.lock);
    expect(await waiting).toBe(7);
    expect(read).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("falls back to store polling when publishing a committed result fails", async () => {
    jest.useFakeTimers();
    try {
      const f = await commandFixture();
      const bus = new MemoryEventBus();
      f.config.eventBus = bus;
      jest
        .spyOn(bus, "publish")
        .mockRejectedValue(new Error("bus unavailable"));
      f.kickoff.mockResolvedValue(undefined);
      const waiting = f.manager.command("run", f.command, 1);
      await jest.advanceTimersByTimeAsync(0);
      await f.manager.drain(f.execution, f.workflow, f.store, f.lock);
      await jest.advanceTimersByTimeAsync(500);
      expect(await waiting).toBe(7);
    } finally {
      jest.useRealTimers();
    }
  });

  it("deduplicates concurrent clients while the target lease is busy", async () => {
    const f = await commandFixture();
    f.kickoff.mockResolvedValue(undefined);
    const outcomes = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        f.manager.command("run", f.command, 1, {
          idempotencyKey: "same",
          waitTimeoutMs: 20,
        }),
      ),
    );
    expect(outcomes.every((outcome) => outcome.status === "rejected")).toBe(
      true,
    );
    expect(f.store.exportSnapshot().commands).toHaveLength(1);
    expect(await f.store.getExecutionTimers("run")).toHaveLength(1);
    await f.manager.drain(f.execution, f.workflow, f.store, f.lock);
    expect(
      await f.manager.command("run", f.command, 99, { idempotencyKey: "same" }),
    ).toBe(7);
    expect(await f.store.getExecutionTimers("run")).toHaveLength(0);
  });
});
