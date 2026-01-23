import { MemoryEventBus } from "../../durable/bus/MemoryEventBus";
import type { BusEvent } from "../../durable/core/interfaces/bus";
import type { Execution, Schedule, Timer } from "../../durable/core/types";
import { MemoryQueue } from "../../durable/queue/MemoryQueue";
import { MemoryStore } from "../../durable/store/MemoryStore";

describe("durable: memory backends", () => {
  describe("MemoryStore", () => {
    let store: MemoryStore;

    beforeEach(() => {
      store = new MemoryStore();
    });

    it("manages executions", async () => {
      expect(await store.getExecution("missing")).toBeNull();
      const exec: Execution = {
        id: "1",
        taskId: "t",
        input: {},
        status: "pending",
        attempt: 1,
        maxAttempts: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await store.saveExecution(exec);
      expect((await store.getExecution("1"))?.id).toBe("1");

      await store.updateExecution("1", { status: "completed" });
      expect((await store.getExecution("1"))?.status).toBe("completed");

      expect((await store.listIncompleteExecutions()).length).toBe(0);

      await store.updateExecution("missing", { status: "failed" });
    });

    it("manages step results", async () => {
      expect(await store.getStepResult("missing", "s1")).toBeNull();
      await store.saveStepResult({
        executionId: "1",
        stepId: "s1",
        result: "ok",
        completedAt: new Date(),
      });
      expect((await store.getStepResult("1", "s1"))?.result).toBe("ok");
    });

    it("manages timers", async () => {
      const t: Timer = {
        id: "t1",
        type: "sleep",
        fireAt: new Date(Date.now() - 1000),
        status: "pending",
      };
      await store.createTimer(t);
      expect((await store.getReadyTimers()).length).toBe(1);

      await store.markTimerFired("t1");
      expect((await store.getReadyTimers()).length).toBe(0);

      await store.markTimerFired("missing");
      await store.deleteTimer("t1");
    });

    it("manages schedules", async () => {
      expect(await store.getSchedule("missing")).toBeNull();
      expect((await store.listSchedules()).length).toBe(0);
      const s: Schedule = {
        id: "s1",
        taskId: "t",
        type: "cron",
        pattern: "* * * * *",
        input: {},
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await store.createSchedule(s);
      expect(await store.getSchedule("s1")).toBeTruthy();

      expect((await store.listActiveSchedules()).length).toBe(1);

      await store.updateSchedule("s1", { status: "paused" });
      expect((await store.listActiveSchedules()).length).toBe(0);

      await store.updateSchedule("missing", { status: "paused" });
      await store.deleteSchedule("s1");
    });

    it("simulates distributed locking", async () => {
      const lockId = await store.acquireLock("res", 1000);
      expect(lockId).not.toBeNull();

      const lockId2 = await store.acquireLock("res", 1000);
      expect(lockId2).toBeNull();

      await store.releaseLock("res", lockId!);
      const lockId3 = await store.acquireLock("res", 1000);
      expect(lockId3).not.toBeNull();
    });
  });

  describe("MemoryQueue", () => {
    let queue: MemoryQueue;

    beforeEach(() => {
      queue = new MemoryQueue();
    });

    it("enqueues and consumes", async () => {
      await queue.enqueue({
        type: "execute",
        payload: { x: 1 },
        maxAttempts: 1,
      });
      let receivedPayload: unknown;

      await queue.consume(async (msg) => {
        receivedPayload = msg.payload;
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(receivedPayload).toEqual({ x: 1 });
    });

    it("is safe to enqueue before consume", async () => {
      await queue.enqueue({
        type: "execute",
        payload: { y: 2 },
        maxAttempts: 1,
      });
      await new Promise((resolve) => setTimeout(resolve, 10));

      let received: unknown;
      await queue.consume(async (msg) => {
        received = msg.payload;
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(received).toEqual({ y: 2 });
    });

    it("handles ack/nack safely", async () => {
      await queue.enqueue({ type: "execute", payload: {}, maxAttempts: 1 });
      let msgId = "";
      await queue.consume(async (msg) => {
        msgId = msg.id;
      });

      await queue.consume(async () => {});
      await queue.ack(msgId);
      await queue.nack(msgId);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  });

  describe("MemoryEventBus", () => {
    it("publishes to subscribers", async () => {
      const bus = new MemoryEventBus();
      const received: BusEvent[] = [];

      await bus.subscribe("topic", async (evt) => {
        received.push(evt);
      });

      await bus.publish("topic", {
        type: "t",
        payload: {},
        timestamp: new Date(),
      });
      expect(received.length).toBe(1);
    });

    it("logs handler errors without crashing", async () => {
      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const bus = new MemoryEventBus();
      await bus.publish("no-subscribers", {
        type: "noop",
        payload: null,
        timestamp: new Date(),
      });
      await bus.subscribe("topic", async () => {
        throw new Error("handler-fail");
      });

      await bus.publish("topic", {
        type: "t",
        payload: {},
        timestamp: new Date(),
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Error in MemoryEventBus handler"),
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });

    it("supports unsubscribe", async () => {
      const bus = new MemoryEventBus();
      const handler = jest.fn(async () => {});
      await bus.subscribe("topic", handler);
      await bus.unsubscribe("topic");
      await bus.publish("topic", {
        type: "t",
        payload: {},
        timestamp: new Date(),
      });
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
