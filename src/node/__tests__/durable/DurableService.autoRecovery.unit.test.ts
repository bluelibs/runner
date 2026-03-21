import { r } from "../../..";
import {
  DurableService,
  initDurableService,
} from "../../durable/core/DurableService";
import type { IDurableQueue } from "../../durable/core/interfaces/queue";
import type { IDurableStore } from "../../durable/core/interfaces/store";
import { ExecutionStatus, type Execution } from "../../durable/core/types";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { waitUntil } from "../../durable/test-utils";
import {
  createBareStore,
  flushMicrotasks,
  SpyQueue,
} from "./DurableService.unit.helpers";

function pendingExecution(id: string, taskId: string): Execution {
  return {
    id,
    taskId,
    input: undefined,
    status: ExecutionStatus.Pending,
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createBlockingQueue(): {
  queue: IDurableQueue;
  release: () => void;
  enqueueSpy: jest.Mock;
} {
  let release!: () => void;
  const enqueuePromise = new Promise<void>((resolve) => {
    release = resolve;
  });
  const enqueueSpy = jest.fn(async () => {
    await enqueuePromise;
    return "m1";
  });

  return {
    queue: {
      enqueue: enqueueSpy,
      consume: jest.fn(async () => {}),
      ack: jest.fn(async () => {}),
      nack: jest.fn(async () => {}),
    },
    release,
    enqueueSpy,
  };
}

describe("durable: DurableService auto recovery (unit)", () => {
  it("starts automatic recovery in the background without blocking init", async () => {
    const store = new MemoryStore();
    const task = r
      .task("durable-tests-auto-recovery-bg")
      .run(async () => "unused")
      .build();

    let started = 0;
    let release!: () => void;
    const finishExecution = new Promise<void>((resolve) => {
      release = resolve;
    });

    await store.saveExecution(pendingExecution("e1", task.id));

    const service = await initDurableService({
      store,
      tasks: [task],
      recovery: { enabledOnInit: true },
      taskExecutor: {
        run: async <TInput, TResult>(
          _task: unknown,
          _input?: TInput,
        ): Promise<TResult> => {
          started += 1;
          await finishExecution;
          return "ok" as TResult;
        },
      },
    });

    expect(service).toBeInstanceOf(DurableService);

    await waitUntil(() => started === 1, {
      timeoutMs: 250,
      intervalMs: 1,
    });

    release();

    await waitUntil(
      async () =>
        (await store.getExecution("e1"))?.status === ExecutionStatus.Completed,
      { timeoutMs: 250, intervalMs: 1 },
    );
  });

  it("fails fast when automatic recovery is enabled without store locks", async () => {
    const baseStore = new MemoryStore();
    const store = createBareStore(baseStore) as IDurableStore;

    await expect(
      initDurableService({
        store,
        recovery: { enabledOnInit: true },
      }),
    ).rejects.toThrow("Durable recovery requires store-level locking");
  });

  it("manual recover reports claimed_elsewhere when background recovery owns the execution", async () => {
    const store = new MemoryStore();
    const task = r
      .task("durable-tests-auto-recovery-claimed-elsewhere")
      .run(async () => "unused")
      .build();
    let release!: () => void;
    const blockExecution = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runSpy = jest.fn(async () => {
      await blockExecution;
      return "ok";
    });

    await store.saveExecution(pendingExecution("e1", task.id));

    const service = await initDurableService({
      store,
      tasks: [task],
      recovery: { enabledOnInit: true },
      taskExecutor: {
        run: async <TResult>(): Promise<TResult> => {
          return (await runSpy()) as TResult;
        },
      },
    });

    await waitUntil(() => runSpy.mock.calls.length === 1, {
      timeoutMs: 250,
      intervalMs: 1,
    });

    const report = await service.recover();

    expect(report).toEqual({
      scannedCount: 1,
      recoveredCount: 0,
      skippedCount: 1,
      failedCount: 0,
      recovered: [],
      skipped: [
        {
          executionId: "e1",
          status: ExecutionStatus.Running,
          reason: "claimed_elsewhere",
        },
      ],
      failures: [],
    });

    release();
    await service.stop();
  });

  it("does not duplicate recovery wake-ups when multiple services auto-recover together", async () => {
    const store = new MemoryStore();
    const queue = new SpyQueue();

    await store.saveExecution(pendingExecution("e1", "task"));
    await store.saveExecution(pendingExecution("e2", "task"));

    const service1 = await initDurableService({
      store,
      queue,
      recovery: { enabledOnInit: true },
    });
    const service2 = await initDurableService({
      store,
      queue,
      recovery: { enabledOnInit: true },
    });

    await waitUntil(() => queue.enqueued.length === 2, {
      timeoutMs: 250,
      intervalMs: 1,
    });

    expect(
      queue.enqueued
        .map(
          (message) => (message.payload as { executionId: string }).executionId,
        )
        .sort(),
    ).toEqual(["e1", "e2"]);

    await service1.stop();
    await service2.stop();
  });

  it("bounds manual recovery concurrency to the default semaphore limit", async () => {
    const store = new MemoryStore();
    const task = r
      .task("durable-tests-recovery-concurrency")
      .run(async () => "unused")
      .build();

    let active = 0;
    let maxActive = 0;
    let started = 0;
    let release!: () => void;
    const unblock = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markTenStarted!: () => void;
    const tenStarted = new Promise<void>((resolve) => {
      markTenStarted = resolve;
    });

    for (let index = 0; index < 11; index += 1) {
      await store.saveExecution(pendingExecution(`e${index}`, task.id));
    }

    const service = new DurableService({
      store,
      tasks: [task],
      taskExecutor: {
        run: async <TInput, TResult>(
          _task: unknown,
          _input?: TInput,
        ): Promise<TResult> => {
          started += 1;
          active += 1;
          maxActive = Math.max(maxActive, active);
          if (started === 10) {
            markTenStarted();
          }
          await unblock;
          active -= 1;
          return "ok" as TResult;
        },
      },
    });

    const recoverPromise = service.recover();

    await tenStarted;
    await flushMicrotasks();

    expect(started).toBe(10);
    expect(maxActive).toBe(10);

    release();

    const report = await recoverPromise;
    expect(report.recoveredCount).toBe(11);
    expect(maxActive).toBe(10);
  });

  it("waits for in-flight background recovery work during stop", async () => {
    const store = new MemoryStore();
    const { queue, release, enqueueSpy } = createBlockingQueue();

    await store.saveExecution(pendingExecution("e1", "task"));

    const service = await initDurableService({
      store,
      queue,
      recovery: { enabledOnInit: true },
    });

    await waitUntil(() => enqueueSpy.mock.calls.length === 1, {
      timeoutMs: 250,
      intervalMs: 1,
    });

    let stopped = false;
    const stopPromise = service.stop().then(() => {
      stopped = true;
    });

    await flushMicrotasks();
    expect(stopped).toBe(false);

    release();
    await stopPromise;

    expect(stopped).toBe(true);
  });
});
