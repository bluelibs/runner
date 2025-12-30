import { r } from "../../..";
import type { ITaskExecutor } from "../core/interfaces/service";
import type { IDurableQueue, QueueMessage } from "../core/interfaces/queue";
import type { MessageHandler } from "../core/interfaces/queue";
import { DurableExecutionError, DurableService } from "../core/DurableService";
import { MemoryEventBus } from "../bus/MemoryEventBus";
import { MemoryStore } from "../store/MemoryStore";

function createTaskExecutor(
  handlers: Record<string, (input: unknown) => Promise<unknown>>,
): ITaskExecutor {
  return {
    run: async (task, input) => {
      const handler = handlers[task.id];
      if (!handler) {
        throw new Error(`No task handler registered for: ${task.id}`);
      }
      return await handler(input);
    },
  };
}

class SpyQueue implements IDurableQueue {
  public enqueued: Array<Pick<QueueMessage, "type" | "payload">> = [];

  async enqueue<T>(
    message: Omit<QueueMessage<T>, "id" | "createdAt" | "attempts">,
  ): Promise<string> {
    this.enqueued.push({ type: message.type, payload: message.payload });
    return "id";
  }

  async consume<T>(_handler: MessageHandler<T>): Promise<void> {}
  async ack(_messageId: string): Promise<void> {}
  async nack(_messageId: string, _requeue?: boolean): Promise<void> {}
}

describe("durable: DurableService waitForResult (eventBus)", () => {
  it("resolves via event bus notification when execution completes", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();
    const queue = new SpyQueue();

    const task = r
      .task("t")
      .run(async () => "ok")
      .build();

    const service = new DurableService({
      store,
      eventBus: bus,
      queue,
      taskExecutor: createTaskExecutor({
        [task.id]: async () => "ok",
      }),
      tasks: [task],
    });

    const id = await service.startExecution(task);

    const waitPromise = service.wait<string>(id, {
      timeout: 5_000,
      waitPollIntervalMs: 1,
    });
    await service.processExecution(id);

    await expect(waitPromise).resolves.toBe("ok");
  });

  it("falls back to polling when event bus subscription fails", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();

    const subscribe = jest.fn(async () => {
      throw new Error("subscribe failed");
    });

    const eventBus = {
      publish: bus.publish.bind(bus),
      subscribe,
      unsubscribe: bus.unsubscribe.bind(bus),
    };

    const service = new DurableService({
      store,
      eventBus,
    });

    await store.saveExecution({
      id: "e1",
      taskId: "t",
      input: undefined,
      status: "pending",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const waitPromise = service.wait<string>("e1", {
      timeout: 5_000,
      waitPollIntervalMs: 1,
    });

    await store.updateExecution("e1", {
      status: "completed",
      result: "ok",
      completedAt: new Date(),
    });

    await expect(waitPromise).resolves.toBe("ok");

    expect(subscribe).toHaveBeenCalled();
  });

  it("rejects with a DurableExecutionError on timeout (eventBus mode)", async () => {
    jest.useFakeTimers();
    try {
      const store = new MemoryStore();
      const bus = new MemoryEventBus();

      const service = new DurableService({
        store,
        eventBus: bus,
        taskExecutor: createTaskExecutor({}),
      });

      await store.saveExecution({
        id: "e1",
        taskId: "t",
        input: undefined,
        status: "running",
        attempt: 1,
        maxAttempts: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const promise = service.wait("e1", { timeout: 5 });
      jest.advanceTimersByTime(10);
      await Promise.resolve();

      await expect(promise).rejects.toBeInstanceOf(DurableExecutionError);
    } finally {
      jest.useRealTimers();
    }
  });

  it("rejects when a finish notification arrives but the execution is completed without result", async () => {
    const bus = new MemoryEventBus();
    const store = new MemoryStore();
    const service = new DurableService({ store, eventBus: bus });

    await store.saveExecution({
      id: "e1",
      taskId: "t",
      input: undefined,
      status: "pending",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const waitPromise = service.wait("e1", {
      timeout: 5_000,
      waitPollIntervalMs: 1,
    });
    await Promise.resolve();

    await store.updateExecution("e1", {
      status: "completed",
      completedAt: new Date(),
    });

    await bus.publish("execution:e1", {
      type: "finished",
      payload: {},
      timestamp: new Date(),
    });

    await expect(waitPromise).rejects.toBeInstanceOf(DurableExecutionError);
  });

  it("uses 'unknown' metadata if execution disappears before eventBus timeout handler runs", async () => {
    jest.useFakeTimers();
    try {
      const bus = new MemoryEventBus();

      class TimeoutStore extends MemoryStore {
        private callCount = 0;
        override async getExecution(id: string) {
          this.callCount += 1;
          if (this.callCount === 1) {
            return await super.getExecution(id);
          }
          return null;
        }
      }

      const store = new TimeoutStore();
      const service = new DurableService({ store, eventBus: bus });

      await store.saveExecution({
        id: "e1",
        taskId: "t",
        input: undefined,
        status: "pending",
        attempt: 1,
        maxAttempts: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const promise = service.wait("e1", { timeout: 5 });
      jest.advanceTimersByTime(10);
      await Promise.resolve();

      await expect(promise).rejects.toMatchObject({
        taskId: "unknown",
        attempt: 0,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it("rejects if reading execution fails during the eventBus timeout handler", async () => {
    jest.useFakeTimers();
    try {
      const bus = new MemoryEventBus();

      class ThrowingTimeoutStore extends MemoryStore {
        private callCount = 0;
        override async getExecution(id: string) {
          this.callCount += 1;
          if (this.callCount === 1) {
            return await super.getExecution(id);
          }
          throw new Error("boom");
        }
      }

      const store = new ThrowingTimeoutStore();
      const service = new DurableService({ store, eventBus: bus });

      await store.saveExecution({
        id: "e1",
        taskId: "t",
        input: undefined,
        status: "pending",
        attempt: 1,
        maxAttempts: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const promise = service.wait("e1", { timeout: 5 });
      jest.advanceTimersByTime(10);
      await Promise.resolve();

      await expect(promise).rejects.toThrow("boom");
    } finally {
      jest.useRealTimers();
    }
  });
});
