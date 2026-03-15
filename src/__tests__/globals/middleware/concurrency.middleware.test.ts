import { defineResource, defineTask } from "../../../define";
import { run } from "../../../run";
import {
  concurrencyResource,
  concurrencyTaskMiddleware,
} from "../../../globals/middleware/concurrency.middleware";
import { Semaphore } from "../../../models/Semaphore";
import { genericError } from "../../../errors";

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

describe("Concurrency Middleware", () => {
  it("should limit concurrent executions using 'limit' config", async () => {
    let activeTasks = 0;
    let maxActiveTasks = 0;
    const executionOrder: number[] = [];

    const task = defineTask({
      id: "concurrency-task",
      middleware: [concurrencyTaskMiddleware.with({ limit: 2 })],
      run: async (id: number) => {
        activeTasks++;
        maxActiveTasks = Math.max(maxActiveTasks, activeTasks);
        await sleep(20);
        executionOrder.push(id);
        activeTasks--;
        return id;
      },
    });

    const app = defineResource({
      id: "app",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        // Run 5 tasks concurrently
        await Promise.all([task(1), task(2), task(3), task(4), task(5)]);
      },
    });

    await run(app);

    expect(maxActiveTasks).toBeLessThanOrEqual(2);
    expect(executionOrder).toHaveLength(5);
  });

  it("should limit concurrent executions using explicit Semaphore", async () => {
    let activeTasks = 0;
    let maxActiveTasks = 0;
    const semaphore = new Semaphore(1);

    const task = defineTask({
      id: "concurrency-semaphoreTask",
      middleware: [concurrencyTaskMiddleware.with({ semaphore })],
      run: async (id: number) => {
        activeTasks++;
        maxActiveTasks = Math.max(maxActiveTasks, activeTasks);
        await sleep(10);
        activeTasks--;
        return id;
      },
    });

    const app = defineResource({
      id: "app",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        await Promise.all([task(1), task(2), task(3)]);
      },
    });

    await run(app);

    expect(maxActiveTasks).toBe(1);
  });

  it("should share semaphore across tasks if they share the same middleware instance", async () => {
    let activeTasks = 0;
    let maxActiveTasks = 0;
    const middleware = concurrencyTaskMiddleware.with({ limit: 1 });

    const taskA = defineTask({
      id: "concurrency-taskA",
      middleware: [middleware],
      run: async () => {
        activeTasks++;
        maxActiveTasks = Math.max(maxActiveTasks, activeTasks);
        await sleep(10);
        activeTasks--;
      },
    });

    const taskB = defineTask({
      id: "concurrency-taskB",
      middleware: [middleware],
      run: async () => {
        activeTasks++;
        maxActiveTasks = Math.max(maxActiveTasks, activeTasks);
        await sleep(10);
        activeTasks--;
      },
    });

    const app = defineResource({
      id: "app",
      register: [taskA, taskB],
      dependencies: { taskA, taskB },
      async init(_, { taskA, taskB }) {
        await Promise.all([taskA(), taskB(), taskA(), taskB()]);
      },
    });

    await run(app);

    expect(maxActiveTasks).toBe(1);
  });

  it("should share semaphore across tasks when explicit 'key' is provided", async () => {
    let activeTasks = 0;
    let maxActiveTasks = 0;
    // Two distinct middleware instances, but with same key -> should share semaphore
    const middleware1 = concurrencyTaskMiddleware.with({
      limit: 1,
      key: "shared-lock",
    });
    const middleware2 = concurrencyTaskMiddleware.with({
      limit: 1,
      key: "shared-lock",
    });

    const runTask = async () => {
      activeTasks++;
      maxActiveTasks = Math.max(maxActiveTasks, activeTasks);
      await sleep(10);
      activeTasks--;
    };

    const taskA = defineTask({
      id: "concurrency-keyedA",
      middleware: [middleware1],
      run: runTask,
    });

    const taskB = defineTask({
      id: "concurrency-keyedB",
      middleware: [middleware2],
      run: runTask,
    });

    const app = defineResource({
      id: "app",
      register: [taskA, taskB],
      dependencies: { taskA, taskB },
      async init(_, { taskA, taskB }) {
        await Promise.all([taskA(), taskB(), taskA(), taskB()]);
      },
    });

    await run(app);

    expect(maxActiveTasks).toBe(1);
  });

  it("should throw when same key is reused with different limits", async () => {
    const middleware1 = concurrencyTaskMiddleware.with({
      limit: 1,
      key: "shared-lock-mismatch",
    });
    const middleware2 = concurrencyTaskMiddleware.with({
      limit: 2,
      key: "shared-lock-mismatch",
    });

    const taskA = defineTask({
      id: "concurrency-keyedMismatchA",
      middleware: [middleware1],
      run: async () => {},
    });

    const taskB = defineTask({
      id: "concurrency-keyedMismatchB",
      middleware: [middleware2],
      run: async () => {},
    });

    const app = defineResource({
      id: "app",
      register: [taskA, taskB],
      dependencies: { taskA, taskB },
      async init(_, { taskA, taskB }) {
        await taskA();
        await taskB();
      },
    });

    await expect(run(app)).rejects.toThrow(
      'Concurrency middleware key "__global__:shared-lock-mismatch" is already registered with limit 1, but got 2',
    );
  });

  it("fails fast when no limit or semaphore is provided", async () => {
    const task = defineTask({
      id: "concurrency-noLimit",
      middleware: [concurrencyTaskMiddleware.with({})],
      run: async () => undefined,
    });

    const app = defineResource({
      id: "app",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        await task();
      },
    });

    await expect(run(app)).rejects.toThrow(
      /requires either "limit" or "semaphore"/i,
    );
  });

  it("fails fast when key is provided without limit", async () => {
    const task = defineTask({
      id: "concurrency-key-no-limit",
      middleware: [concurrencyTaskMiddleware.with({ key: "shared" } as never)],
      run: async () => undefined,
    });

    const app = defineResource({
      id: "app",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        await task();
      },
    });

    await expect(run(app)).rejects.toThrow(/key" requires "limit"/i);
  });

  it("fails fast when semaphore is mixed with limit/key config", async () => {
    const semaphore = new Semaphore(1);
    const task = defineTask({
      id: "concurrency-ambiguous-config",
      middleware: [
        concurrencyTaskMiddleware.with({
          semaphore,
          limit: 1,
          key: "ambiguous",
        } as never),
      ],
      run: async () => undefined,
    });

    const app = defineResource({
      id: "app",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        await task();
      },
    });

    await expect(run(app)).rejects.toThrow(
      /use either \{ semaphore \} or \{ limit, key\? \}/i,
    );
  });

  it("should release permit when task fails", async () => {
    const semaphore = new Semaphore(1);
    let callCount = 0;

    const failingTask = defineTask({
      id: "concurrency-failing",
      middleware: [concurrencyTaskMiddleware.with({ semaphore })],
      run: async () => {
        callCount++;
        if (callCount === 1) {
          throw genericError.new({ message: "Failed" });
        }
        return "ok";
      },
    });

    const app = defineResource({
      id: "app",
      register: [failingTask],
      dependencies: { failingTask },
      async init(_, { failingTask }) {
        await expect(failingTask()).rejects.toThrow("Failed");
        const result = await failingTask();
        expect(result).toBe("ok");
      },
    });

    await run(app);
    expect(callCount).toBe(2);
    expect(semaphore.getAvailablePermits()).toBe(1);
  });

  it("should dispose internally created semaphores on runtime dispose", async () => {
    const key = "concurrency.dispose.key";
    let trackedSemaphore: Semaphore | undefined;

    const task = defineTask({
      id: "concurrency-dispose-task",
      middleware: [concurrencyTaskMiddleware.with({ limit: 1, key })],
      run: async () => "ok",
    });

    const app = defineResource({
      id: "app",
      register: [task],
      dependencies: { task, state: concurrencyResource },
      async init(_, { task, state }) {
        await task();
        trackedSemaphore = state.semaphoresByKey.get(
          `__global__:${key}`,
        )?.semaphore;
      },
    });

    const runtime = await run(app);
    expect(trackedSemaphore).toBeDefined();
    expect(trackedSemaphore?.isDisposed()).toBe(false);

    await runtime.dispose();
    expect(trackedSemaphore?.isDisposed()).toBe(true);
  });
});
