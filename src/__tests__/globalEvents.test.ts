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

    const app = defineResource({
      id: "app",
      register: [testResource, testTask],
      dependencies: { testResource, testTask },
      hooks: [
        { event: globalEvents.beforeInit, run: globalBeforeInitHandler },
        { event: globalEvents.afterInit, run: globalAfterInitHandler },
        {
          event: globalEvents.tasks.beforeRun,
          run: globalTaskBeforeRunHandler,
        },
        {
          event: globalEvents.tasks.afterRun,
          run: globalTaskAfterRunHandler,
        },
        {
          event: globalEvents.resources.beforeInit,
          run: globalResourceBeforeInitHandler,
        },
        {
          event: globalEvents.resources.afterInit,
          run: globalResourceAfterInitHandler,
        },
      ],
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

    const app = defineResource({
      id: "app",
      register: [errorTask],
      dependencies: { errorTask },
      hooks: [
        {
          event: globalEvents.tasks.onError,
          run: globalTaskOnErrorHandler,
        },
      ],
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
