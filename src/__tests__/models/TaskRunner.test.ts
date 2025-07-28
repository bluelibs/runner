import { TaskRunner } from "../../models/TaskRunner";
import { Store } from "../../models/Store";
import { EventManager } from "../../models/EventManager";
import { defineTask, defineResource, defineMiddleware } from "../../define";
import { ITask } from "../../defs";
import { Logger } from "../../models";

describe("TaskRunner", () => {
  let store: Store;
  let eventManager: EventManager;
  let taskRunner: TaskRunner;
  let logger: Logger;

  beforeEach(() => {
    eventManager = new EventManager();
    logger = new Logger(eventManager);
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

  it("should emit events during task execution", async () => {
    const task = defineTask({
      id: "testTask",
      run: async (input: number) => input * 2,
    });

    store.tasks.set(task.id, {
      task,
      computedDependencies: {},
      isInitialized: false,
    });

    const beforeRunSpy = jest.fn();
    const afterRunSpy = jest.fn();

    eventManager.addListener(task.events.beforeRun, beforeRunSpy);
    eventManager.addListener(task.events.afterRun, afterRunSpy);

    await taskRunner.run(task, 5);

    expect(beforeRunSpy).toHaveBeenCalledWith(
      expect.objectContaining({ data: { input: 5 } })
    );
    expect(afterRunSpy).toHaveBeenCalledWith(
      expect.objectContaining({ data: { input: 5, output: 10 } })
    );
  });

  it("should handle errors and emit onError event", async () => {
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

    const onErrorSpy = jest.fn();
    eventManager.addListener(task.events.onError, onErrorSpy);

    expect(taskRunner.run(task, undefined)).rejects.toThrow(error);

    // since it quickly throws and is not run asnc we might need to wait a bit
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(onErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { error, suppress: expect.any(Function) },
      })
    );
  });
});
