import { TaskRunner } from "../../models/TaskRunner";
import { Store } from "../../models/Store";
import { EventManager } from "../../models/EventManager";
import { defineTask, defineResource, defineMiddleware } from "../../define";
import { ITask } from "../../defs";
import { Logger } from "../../models";
import { globalEvents } from "../../globals/globalEvents";

describe("TaskRunner", () => {
  let store: Store;
  let eventManager: EventManager;
  let taskRunner: TaskRunner;
  let logger: Logger;

  beforeEach(() => {
    eventManager = new EventManager();
    logger = new Logger({
      printThreshold: "info",
      printStrategy: "pretty",
      bufferLogs: false,
    });
    store = new Store(eventManager, logger);
    taskRunner = new TaskRunner(store, eventManager, logger);
  });

  it("should run an task without middleware", async () => {
    const app = defineResource({
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

  it("should run an task with middleware", async () => {
    const middleware1 = defineMiddleware({
      id: "middleware1",
      run: async ({ next, task }) => {
        const result = await next(task?.input);
        return result + 1;
      },
    });

    const middleware2 = defineMiddleware({
      id: "middleware2",
      run: async ({ task, next }, deps, config) => {
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
    store.middlewares.set(middleware1.id, {
      middleware: middleware1,
      computedDependencies: {},
    });
    store.middlewares.set(middleware2.id, {
      middleware: middleware2,
      computedDependencies: {},
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
