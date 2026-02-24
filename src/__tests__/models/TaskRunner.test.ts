import { TaskRunner } from "../../models/TaskRunner";
import { Store } from "../../models/Store";
import { defineTask, defineResource, defineTaskMiddleware } from "../../define";
import { getPlatform } from "../../platform";
import { createMessageError } from "../../errors";

import { createTestFixture } from "../test-utils";

describe("TaskRunner", () => {
  let store: Store;
  let taskRunner: TaskRunner;
  // no logger or onUnhandledError needed

  beforeEach(() => {
    const fixture = createTestFixture();
    store = fixture.store;

    taskRunner = fixture.createTaskRunner();
  });

  it("should run a task without middleware", async () => {
    defineResource({
      id: "app",
      register: () => [task],
    });

    const task = defineTask({
      id: "testTask",
      run: async (input: number) => input * 2,
    });

    store.tasks.set(task.id, {
      task,
      computedDependencies: {},
      isInitialized: false,
    });

    const result = await taskRunner.run(task, 5);
    expect(result).toBe(10);
  });

  it("should run a task with middleware", async () => {
    const middleware1 = defineTaskMiddleware({
      id: "middleware1",
      run: async ({ next, task }) => {
        const result = await next(task?.input);
        return result + 1;
      },
    });

    const middleware2 = defineTaskMiddleware({
      id: "middleware2",
      run: async ({ task, next }, _deps, _config) => {
        const result = await next(task?.input);
        return result * 2;
      },
    });

    const task = defineTask({
      id: "testTask",
      middleware: [middleware1, middleware2],
      run: async (input: number) => input + 5,
    });

    store.tasks.set(task.id, {
      task,
      computedDependencies: {},
      isInitialized: true,
    });
    store.taskMiddlewares.set(middleware1.id, {
      middleware: middleware1,
      computedDependencies: {},
      isInitialized: true,
    });
    store.taskMiddlewares.set(middleware2.id, {
      middleware: middleware2,
      computedDependencies: {},
      isInitialized: true,
    });

    const result = await taskRunner.run(task, 5);
    expect(result).toBe(21); // ((5 + 5) * 2) + 1
  });

  it("should recompose task runner before store lock so new interceptors are applied", async () => {
    const task = defineTask({
      id: "taskRunner.recompose.beforeLock",
      run: async (input: number) => input,
    });

    store.tasks.set(task.id, {
      task,
      computedDependencies: {},
      isInitialized: true,
    });

    const firstResult = await taskRunner.run(task, 5);
    expect(firstResult).toBe(5);

    store
      .getMiddlewareManager()
      .intercept("task", async (_, executionInput) => {
        return executionInput.next(executionInput.task.input + 1);
      });

    const secondResult = await taskRunner.run(task, 5);
    expect(secondResult).toBe(6);
  });

  // Lifecycle emissions removed

  it("should throw errors from task execution", async () => {
    const error = new Error("Test error");
    const task = defineTask({
      id: "testTask",
      run: async () => {
        throw error;
      },
    });

    store.tasks.set(task.id, {
      task,
      computedDependencies: {},
      isInitialized: false,
    });

    await expect(taskRunner.run(task, undefined)).rejects.toThrow(error);
  });

  it("should not support error suppression anymore", async () => {
    const error = new Error("Test error");

    const task = defineTask({
      id: "testTask",
      run: async () => {
        throw error;
      },
    });

    store.tasks.set(task.id, {
      task,
      computedDependencies: {},
      isInitialized: false,
    });

    await expect(taskRunner.run(task, undefined)).rejects.toThrow(error);
  });

  it("allows waitForIdle with allowCurrentContext from inside a running task", async () => {
    const task = defineTask({
      id: "testTask.waitForIdle.currentContext",
      run: async () => {
        await expect(
          taskRunner.waitForIdle({ allowCurrentContext: true }),
        ).resolves.toBeUndefined();
        return "ok";
      },
    });

    store.tasks.set(task.id, {
      task,
      computedDependencies: {},
      isInitialized: false,
    });

    await expect(taskRunner.run(task, undefined)).resolves.toBe("ok");
  });

  it("does not route task execution errors to onUnhandledError", async () => {
    const error = new Error("Business logic error");
    const onUnhandledErrorSpy = jest.spyOn(store, "onUnhandledError");

    const task = defineTask({
      id: "testTask.unhandled",
      run: async () => {
        throw error;
      },
    });

    store.tasks.set(task.id, {
      task,
      computedDependencies: {},
      isInitialized: false,
    });

    await expect(taskRunner.run(task, undefined)).rejects.toThrow(error);
    expect(onUnhandledErrorSpy).not.toHaveBeenCalled();
  });

  it("rejects new task runs when shutdown lockdown is active", async () => {
    const task = defineTask({
      id: "testTask.lockdown",
      run: async () => "ok",
    });

    store.tasks.set(task.id, {
      task,
      computedDependencies: {},
      isInitialized: false,
    });

    store.enterShutdownLockdown();

    await expect(taskRunner.run(task)).rejects.toThrow(
      "Runtime is shutting down and no new task runs or event emissions are accepted.",
    );
  });

  it("runs without async local storage support", async () => {
    const platform = getPlatform();
    const hasAsyncLocalStorageSpy = jest
      .spyOn(platform, "hasAsyncLocalStorage")
      .mockReturnValue(false);

    try {
      const fixture = createTestFixture();
      const localTaskRunner = fixture.createTaskRunner();

      const task = defineTask({
        id: "testTask.no-als",
        run: async (input: number) => input + 1,
      });

      fixture.store.tasks.set(task.id, {
        task,
        computedDependencies: {},
        isInitialized: false,
      });

      await expect(localTaskRunner.run(task, 2)).resolves.toBe(3);
    } finally {
      hasAsyncLocalStorageSpy.mockRestore();
    }
  });

  it("keeps waitForIdle pending until all in-flight task runs complete", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    let releaseSecond: (() => void) | undefined;
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });

    let runCount = 0;
    const task = defineTask({
      id: "testTask.waitForIdle.pending",
      run: async () => {
        runCount += 1;
        if (runCount === 1) {
          await firstGate;
          return "first";
        }
        await secondGate;
        return "second";
      },
    });

    store.tasks.set(task.id, {
      task,
      computedDependencies: {},
      isInitialized: false,
    });

    const firstRun = taskRunner.run(task);
    const secondRun = taskRunner.run(task);

    let idleResolved = false;
    const idlePromise = taskRunner.waitForIdle().then(() => {
      idleResolved = true;
    });

    if (!releaseFirst || !releaseSecond) {
      throw createMessageError("Expected task gates to be initialized");
    }

    releaseFirst();
    await firstRun;
    await Promise.resolve();
    expect(idleResolved).toBe(false);

    releaseSecond();
    await secondRun;
    await idlePromise;
    expect(idleResolved).toBe(true);
  });

  // Global lifecycle events removed
});
