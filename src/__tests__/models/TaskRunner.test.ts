import { TaskRunner } from "../../models/TaskRunner";
import { Store } from "../../models/Store";
import { EventManager } from "../../models/EventManager";
import { defineTask, defineResource, defineTaskMiddleware } from "../../define";
import { Logger } from "../../models";
import { createTestFixture } from "../test-utils";

describe("TaskRunner", () => {
  let store: Store;
  let eventManager: EventManager;
  let taskRunner: TaskRunner;
  let logger: Logger;

  beforeEach(() => {
    const fixture = createTestFixture();
    store = fixture.store;
    eventManager = fixture.eventManager;
    logger = fixture.logger;
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

  // Global lifecycle events removed
});
