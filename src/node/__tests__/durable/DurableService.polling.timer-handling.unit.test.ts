import type { IDurableQueue } from "../../durable/core/interfaces/queue";
import {
  DurableService,
  initDurableService,
} from "../../durable/core/DurableService";
import type { Timer } from "../../durable/core/types";
import { MemoryStore } from "../../durable/store/MemoryStore";
import {
  advanceTimers,
  createBufferedLogger,
  createTaskExecutor,
  SpyQueue,
  sleepingExecution,
} from "./DurableService.unit.helpers";
import { genericError } from "../../../errors";

function createDelayedQueue(delayMs: number): IDurableQueue {
  return {
    enqueue: jest.fn(
      async () =>
        await new Promise<string>((resolve) => {
          setTimeout(() => resolve("m1"), delayMs);
        }),
    ),
    consume: jest.fn(async () => {}),
    ack: jest.fn(async () => {}),
    nack: jest.fn(async () => {}),
  };
}

async function handleTimer(
  service: DurableService,
  timer: Timer,
): Promise<void> {
  return await (
    service as unknown as { handleTimer: (timerInput: Timer) => Promise<void> }
  ).handleTimer(timer);
}

describe("durable: DurableService polling timer handling (unit)", () => {
  it("enqueues resumes when a queue is configured", async () => {
    const store = new MemoryStore();
    const queue = new SpyQueue();
    const service = await initDurableService({
      store,
      queue,
      taskExecutor: createTaskExecutor({}),
      polling: { interval: 5 },
    });

    await store.createTimer({
      id: "t1",
      executionId: "e1",
      type: "retry",
      fireAt: new Date(Date.now() - 10),
      status: "pending",
    });

    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(queue.enqueued).toEqual([
      { type: "resume", payload: { executionId: "e1" } },
    ]);
    expect(((store as any).timers as Map<string, unknown>).has("t1")).toBe(
      false,
    );

    await service.stop();
  });

  it("renews timer claims while a long-running timer handler is still active", async () => {
    jest.useFakeTimers();

    try {
      const store = new MemoryStore();
      const renewTimerClaimSpy = jest.spyOn(store, "renewTimerClaim");
      const service = new DurableService({
        store,
        queue: createDelayedQueue(1_200),
        taskExecutor: createTaskExecutor({}),
        polling: { claimTtlMs: 3_000 },
      });

      const timer: Timer = {
        id: "t-renew-claim",
        executionId: "e1",
        type: "retry",
        fireAt: new Date(0),
        status: "pending",
      };
      await store.createTimer(timer);

      const handleTimerPromise = service.handleTimer(timer);
      await advanceTimers(1_100);
      await advanceTimers(200);
      await handleTimerPromise;

      expect(renewTimerClaimSpy).toHaveBeenCalledWith(
        "t-renew-claim",
        expect.any(String),
        3_000,
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it("keeps timers pending when the timer claim is lost mid-handler", async () => {
    jest.useFakeTimers();

    try {
      const store = new MemoryStore();
      jest.spyOn(store, "renewTimerClaim").mockResolvedValue(false);
      const { logger, logs } = createBufferedLogger();
      const service = new DurableService({
        store,
        queue: createDelayedQueue(1_200),
        taskExecutor: createTaskExecutor({}),
        polling: { claimTtlMs: 3_000 },
        logger,
      });

      const timer: Timer = {
        id: "t-lost-claim",
        executionId: "e-lost-claim",
        type: "retry",
        fireAt: new Date(0),
        status: "pending",
      };
      await store.createTimer(timer);

      const handleTimerPromise = service.handleTimer(timer);
      await advanceTimers(1_100);
      await advanceTimers(200);
      await handleTimerPromise;

      expect(
        (await store.getReadyTimers(new Date(Date.now() + 60_000))).some(
          (readyTimer) => readyTimer.id === timer.id,
        ),
      ).toBe(true);
      expect(logs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            level: "error",
            message: "Durable timer handling failed.",
          }),
        ]),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it("handles sleep timer branches directly", async () => {
    const store = new MemoryStore();
    const service = new DurableService({
      store,
      audit: { enabled: true },
      tasks: [],
    });

    await store.saveExecution(
      sleepingExecution({ attempt: 3, maxAttempts: 3 }),
    );

    await handleTimer(service, {
      id: "t1",
      type: "sleep",
      executionId: "e1",
      stepId: "sleep:1",
      fireAt: new Date(),
      status: "pending",
    });

    await handleTimer(service, {
      id: "t2",
      type: "sleep",
      stepId: "sleep:missing",
      fireAt: new Date(),
      status: "pending",
    });

    await handleTimer(service, {
      id: "t3-missing-execution",
      type: "sleep",
      executionId: "missing-execution",
      stepId: "sleep:missing-execution",
      fireAt: new Date(),
      status: "pending",
    });

    await handleTimer(service, {
      id: "t4",
      type: "sleep",
      executionId: "e-missing",
      stepId: "sleep:missing-exec",
      fireAt: new Date(),
      status: "pending",
    });

    const audit = await store.listAuditEntries("e1");
    const missingAudit = await store.listAuditEntries("e-missing");

    expect(audit.some((entry) => entry.kind === "sleep_completed")).toBe(true);
    expect(missingAudit[0]?.attempt).toBe(0);
  });

  it("skips timers when claimTimer returns false", async () => {
    const store = new MemoryStore();
    const service = new DurableService({
      store,
      workerId: "worker-2",
      tasks: [],
    });

    const timer: Timer = {
      id: "t-claimed",
      type: "sleep",
      executionId: "exec-claimed",
      stepId: "sleep:1",
      fireAt: new Date(0),
      status: "pending",
    };

    await store.createTimer(timer);
    await store.claimTimer(timer.id, "worker-1", 60_000);
    await handleTimer(service, timer);

    const result = await store.getStepResult("exec-claimed", "sleep:1");
    expect(result).toBeNull();
  });

  it("logs polling loop failures and safely ignores no-op scheduled timers", async () => {
    class ExplodingStore extends MemoryStore {
      public shouldThrow = false;

      override async getReadyTimers(now?: Date) {
        if (this.shouldThrow) {
          throw genericError.new({ message: "boom" });
        }

        return await super.getReadyTimers(now);
      }
    }

    const store = new ExplodingStore();
    const { logger, logs } = createBufferedLogger();
    const service = await initDurableService({
      store,
      taskExecutor: createTaskExecutor({}),
      polling: { interval: 5 },
      logger,
    });

    await store.createTimer({
      id: "no-taskid",
      type: "scheduled",
      fireAt: new Date(Date.now() - 10),
      status: "pending",
    });
    await store.createTimer({
      id: "unknown-task",
      taskId: "missing",
      type: "scheduled",
      fireAt: new Date(Date.now() - 10),
      status: "pending",
    });

    await new Promise((resolve) => setTimeout(resolve, 25));

    store.shouldThrow = true;
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          message: "Durable polling loop failed.",
        }),
      ]),
    );

    await service.stop();
  });
});
