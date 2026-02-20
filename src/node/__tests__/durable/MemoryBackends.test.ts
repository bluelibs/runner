import { MemoryEventBus } from "../../durable/bus/MemoryEventBus";
import type { BusEvent } from "../../durable/core/interfaces/bus";
import type { Execution, Schedule, Timer } from "../../durable/core/types";
import { MemoryQueue } from "../../durable/queue/MemoryQueue";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { createMessageError } from "../../../errors";
import { Logger, type ILog } from "../../../models/Logger";

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
        await queue.ack(msg.id);
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
        await queue.ack(msg.id);
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(received).toEqual({ y: 2 });
    });

    it("handles ack/nack safely", async () => {
      await queue.enqueue({ type: "execute", payload: {}, maxAttempts: 1 });
      await queue.consume(async (msg) => {
        await queue.ack(msg.id);
      });

      await queue.ack("missing");
      await queue.nack("missing");
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    it("requeues on nack when requested", async () => {
      await queue.enqueue({ type: "execute", payload: {}, maxAttempts: 2 });
      const attempts: number[] = [];

      await queue.consume(async (msg) => {
        attempts.push(msg.attempts);
        if (msg.attempts === 1) {
          await queue.nack(msg.id, true);
          return;
        }
        await queue.ack(msg.id);
      });

      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(attempts).toEqual([1, 2]);
    });

    it("does not requeue when nack requeue=false", async () => {
      await queue.enqueue({ type: "execute", payload: {}, maxAttempts: 2 });
      let calls = 0;

      await queue.consume(async (msg) => {
        calls += 1;
        await queue.nack(msg.id, false);
      });

      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(calls).toBe(1);
    });

    it("does not requeue after maxAttempts is reached", async () => {
      await queue.enqueue({ type: "execute", payload: {}, maxAttempts: 1 });
      let calls = 0;

      await queue.consume(async (msg) => {
        calls += 1;
        await queue.nack(msg.id, true);
      });

      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(calls).toBe(1);
    });

    it("requeues when handler throws before ack/nack", async () => {
      await queue.enqueue({ type: "execute", payload: {}, maxAttempts: 2 });
      let calls = 0;

      await queue.consume(async (msg) => {
        calls += 1;
        if (msg.attempts === 1) {
          throw createMessageError("handler-crash");
        }
        await queue.ack(msg.id);
      });

      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(calls).toBe(2);
    });

    it("does not requeue thrown handlers when maxAttempts is already reached", async () => {
      await queue.enqueue({ type: "execute", payload: {}, maxAttempts: 1 });
      let calls = 0;

      await queue.consume(async () => {
        calls += 1;
        throw createMessageError("handler-crash-no-requeue");
      });

      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(calls).toBe(1);
    });

    it("drops messages that exceed maxAttempts", async () => {
      await queue.enqueue({ type: "execute", payload: {}, maxAttempts: 0 });
      const handler = jest.fn();

      await queue.consume(async (msg) => {
        handler(msg);
        await queue.ack(msg.id);
      });

      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(handler).not.toHaveBeenCalled();
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
      const onHandlerError = jest.fn();

      const bus = new MemoryEventBus({ onHandlerError });
      await bus.publish("no-subscribers", {
        type: "noop",
        payload: null,
        timestamp: new Date(),
      });
      await bus.subscribe("topic", async () => {
        throw createMessageError("handler-fail");
      });

      await bus.publish("topic", {
        type: "t",
        payload: {},
        timestamp: new Date(),
      });

      expect(onHandlerError).toHaveBeenCalledWith(expect.any(Error));
    });

    it("reports handler errors through logger when callback is not provided", async () => {
      const logs: ILog[] = [];
      const logger = new Logger({
        printThreshold: null,
        printStrategy: "pretty",
        bufferLogs: false,
      });
      logger.onLog((log) => {
        logs.push(log);
      });

      const bus = new MemoryEventBus({ logger });
      await bus.subscribe("topic", async () => {
        throw createMessageError("logger-path");
      });

      await bus.publish("topic", {
        type: "t",
        payload: {},
        timestamp: new Date(),
      });

      expect(logs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            level: "error",
            message: "MemoryEventBus handler failed.",
          }),
        ]),
      );
    });

    it("logs callback failures when onHandlerError throws", async () => {
      const logs: ILog[] = [];
      const logger = new Logger({
        printThreshold: null,
        printStrategy: "pretty",
        bufferLogs: false,
      });
      logger.onLog((log) => {
        logs.push(log);
      });

      const bus = new MemoryEventBus({
        logger,
        onHandlerError: async () => {
          throw createMessageError("callback-failed");
        },
      });
      await bus.subscribe("topic", async () => {
        throw createMessageError("handler-failed");
      });

      await bus.publish("topic", {
        type: "t",
        payload: {},
        timestamp: new Date(),
      });

      expect(logs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            level: "error",
            message: "MemoryEventBus error callback failed.",
          }),
        ]),
      );
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

    it("supports unsubscribe with a handler and no-op on unknown channel", async () => {
      const bus = new MemoryEventBus();
      const handler = jest.fn(async () => {});
      await bus.unsubscribe("missing", handler);
      await bus.subscribe("topic", handler);
      await bus.unsubscribe("topic", handler);
      await bus.publish("topic", {
        type: "t",
        payload: {},
        timestamp: new Date(),
      });
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
