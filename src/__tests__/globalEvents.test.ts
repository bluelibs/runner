import { globalEvents } from "../globalEvents";
import { defineTask, defineResource } from "../define";
import { run } from "../run";

describe("Global Events", () => {
  it("should emit global events during resource initialization and task execution", async () => {
    const globalBeforeInitHandler = jest.fn();
    const globalAfterInitHandler = jest.fn();
    const globalTaskBeforeRunHandler = jest.fn();
    const globalTaskAfterRunHandler = jest.fn();
    const globalResourceBeforeInitHandler = jest.fn();
    const globalResourceAfterInitHandler = jest.fn();

    const testResource = defineResource({
      id: "test.resource",
      init: async () => "Resource Value",
    });

    const testTask = defineTask({
      id: "test.task",
      run: async () => {
        return "Task Result";
      },
    });

    const taskBeforeInit = defineTask({
      id: "task.beforeInit",
      on: globalEvents.beforeInit,
      run: globalBeforeInitHandler,
    });

    const taskAfterInit = defineTask({
      id: "task.afterInit",
      on: globalEvents.afterInit,
      run: globalAfterInitHandler,
    });

    const taskBeforeRun = defineTask({
      id: "task.beforeRun",
      on: globalEvents.tasks.beforeRun,
      run: globalTaskBeforeRunHandler,
    });

    const taskAfterRun = defineTask({
      id: "task.afterRun",
      on: globalEvents.tasks.afterRun,
      run: globalTaskAfterRunHandler,
    });

    const resourceBeforeInit = defineTask({
      id: "resource.beforeInit",
      on: globalEvents.resources.beforeInit,
      run: globalResourceBeforeInitHandler,
    });

    const resourceAfterInit = defineTask({
      id: "resource.afterInit",
      on: globalEvents.resources.afterInit,
      run: globalResourceAfterInitHandler,
    });

    const app = defineResource({
      id: "app",
      register: [
        testResource,
        testTask,
        taskBeforeInit,
        taskAfterInit,
        taskBeforeRun,
        taskAfterRun,
        resourceBeforeInit,
        resourceAfterInit,
      ],
      dependencies: { testResource, testTask },
      async init(_, { testResource, testTask }) {
        expect(testResource).toBe("Resource Value");
        const response = await testTask();
      },
    });

    await run(app);

    expect(globalBeforeInitHandler).toHaveBeenCalled();
    expect(globalAfterInitHandler).toHaveBeenCalled();
    expect(globalResourceBeforeInitHandler).toHaveBeenCalled();
    expect(globalResourceAfterInitHandler).toHaveBeenCalled();
    expect(globalTaskBeforeRunHandler).toHaveBeenCalled();
    expect(globalTaskAfterRunHandler).toHaveBeenCalled();
  });

  it("should emit global error event when an task throws an error", async () => {
    const globalTaskOnErrorHandler = jest.fn();

    const errorTask = defineTask({
      id: "error.task",
      run: async () => {
        throw new Error("Test Error");
      },
    });

    const onErrorHandler = defineTask({
      id: "on.error.handler",
      on: globalEvents.tasks.onError,
      run: globalTaskOnErrorHandler,
    });

    const app = defineResource({
      id: "app",
      register: [errorTask, onErrorHandler],
      dependencies: { errorTask },
      async init(_, { errorTask }) {
        try {
          await errorTask();
        } catch (error) {
          // Error is expected
        }
      },
    });

    await run(app);

    expect(globalTaskOnErrorHandler).toHaveBeenCalled();
  });
});
