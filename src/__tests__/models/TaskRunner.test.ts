import { TaskRunner } from "../../models/TaskRunner";
import { Store } from "../../models/Store";
import { defineTask, defineResource, defineTaskMiddleware } from "../../define";

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

  // Global lifecycle events removed
});
