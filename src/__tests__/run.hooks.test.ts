import {
  defineTask,
  defineResource,
  defineEvent,
  defineMiddleware,
} from "../define";
import { run } from "../run";

describe("run", () => {
  // Tasks
  describe("Hooks", () => {
    it("should work with hooks and beforeInit, afterInit, onError", async () => {
      const beforeInitHandler = jest.fn();
      const afterInitHandler = jest.fn();
      const onErrorHandler = jest.fn();

      const testResource = defineResource({
        id: "test.resource",
        init: async () => "Resource Value",
      });

      const app = defineResource({
        id: "app",
        register: [testResource],
        dependencies: { testResource },
        hooks: [
          { event: testResource.events.beforeInit, run: beforeInitHandler },
          { event: testResource.events.afterInit, run: afterInitHandler },
          { event: testResource.events.onError, run: onErrorHandler },
        ],
        async init(_, { testResource }) {
          expect(testResource).toBe("Resource Value");
          expect(beforeInitHandler).toHaveBeenCalled();
          expect(afterInitHandler).toHaveBeenCalled();
          expect(onErrorHandler).not.toHaveBeenCalled();
        },
      });

      await run(app);
    });

    it("should work with hooks() as function and config and beforeInit, afterInit, onError", async () => {
      const beforeInitHandler = jest.fn();
      const afterInitHandler = jest.fn();
      const onErrorHandler = jest.fn();

      const testResource = defineResource({
        id: "test.resource",
        init: async () => "Resource Value",
      });

      const app = defineResource({
        id: "app",
        register: [testResource],
        dependencies: { testResource },
        hooks: () => [
          { event: testResource.events.beforeInit, run: beforeInitHandler },
          { event: testResource.events.afterInit, run: afterInitHandler },
          { event: testResource.events.onError, run: onErrorHandler },
        ],
        async init(_: { secret: string }, { testResource }) {
          expect(testResource).toBe("Resource Value");
          expect(_.secret).toBe("XXX");
          expect(beforeInitHandler).toHaveBeenCalled();
          expect(afterInitHandler).toHaveBeenCalled();
          expect(onErrorHandler).not.toHaveBeenCalled();
        },
      });

      const wrapper = defineResource({
        id: "root",
        register: [app.with({ secret: "XXX" })],
      });

      await run(wrapper);
    });

    it("should work with hooks", async () => {
      const hookEvent = defineEvent<{ message: string }>({ id: "hook.event" });
      const hookHandler = jest.fn();

      const testResource = defineResource({
        id: "test.resource",
        init: async () => "Resource Value",
        hooks: [
          {
            event: hookEvent,
            run: hookHandler,
          },
        ],
      });

      const app = defineResource({
        id: "app",
        register: [hookEvent, testResource],
        dependencies: { testResource, hookEvent },
        async init(_, { testResource, hookEvent }) {
          await hookEvent({ message: "Hook triggered" });

          expect(hookHandler).toHaveBeenCalledWith(
            expect.objectContaining({ data: { message: "Hook triggered" } }),
            expect.anything()
          );
        },
      });

      await run(app);
    });

    it("should have propper type safety", async () => {
      const hookEvent = defineEvent<{ message: string }>({ id: "hook.event" });

      const task = defineTask({
        id: "task",
        run: async () => "Task executed",
      });

      const testResource = defineResource({
        id: "test.resource",
        dependencies: { task },
        init: async () => "Resource Value",
        hooks: [
          {
            event: hookEvent,
            run: (event, deps) => {
              // @ts-expect-error
              event.data.x;

              event.data.message;
              deps.task;
              // @ts-expect-error
              deps.task2;
            },
          },
        ],
      });

      expect(true).toBe(true);
    });
  });
});
