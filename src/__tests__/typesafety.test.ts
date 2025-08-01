import {
  defineEvent,
  defineTask,
  defineResource,
  defineMiddleware,
} from "../define";
import {
  IEventDefinition,
  IMiddlewareDefinition,
  IResource,
  IResourceWithConfig,
  ITaskDefinition,
  RegisterableItems,
} from "../defs";

describe("typesafety", () => {
  it("tasks, resources: should have propper type safety for dependeices", async () => {
    type InputTask = {
      message: string;
    };

    const middleware = defineMiddleware({
      id: "middleware",
      run: async (input, deps) => {
        return input;
      },
    });

    type MiddlewareConfig = {
      message: string;
    };

    type MiddlewareOptionalConfig = {
      message?: string;
    };

    const middlewareWithConfig = defineMiddleware({
      id: "middleware.config",
      run: async (input, deps, config: MiddlewareConfig) => {
        return input;
      },
    });

    const middlewareWithOptionalConfig = defineMiddleware({
      id: "middleware.optional.config",
      run: async (input, deps, config: MiddlewareOptionalConfig) => {
        return input;
      },
    });

    const event = defineEvent<{ message: string }>({
      id: "event",
    });

    const eventWithoutArguments = defineEvent({
      id: "event",
    });

    const baseTask = defineTask({
      id: "task",
      run: async (input: InputTask) => "Task executed",
    });

    const task = defineTask({
      id: "task",
      dependencies: { baseTask, event },
      run: async (input: InputTask, deps) => {
        deps.event({ message: input.message });
        // @ts-expect-error
        deps.event({ messagex: input.message });

        deps.baseTask({
          message: "Hello, World!",
        });

        deps.baseTask({
          // @ts-expect-error
          messagex: 123,
        });

        // bc no arguments and its required
        // @ts-expect-error
        deps.baseTask();
      },
    });

    type ResourceType = {
      ok: boolean;
    };

    const dummyResource = defineResource({
      id: "dummy.resource",
      init: async (config: ResourceType) => "Resource Value",
    });
    const dummyResourceNoConfig = defineResource({
      id: "dummy.resource",
      init: async () => "Resource Value",
    });
    const dummyResourceOptionalConfig = defineResource({
      id: "dummy.resource",
      init: async (config?: string) => "Resource Value",
    });

    const testResource = defineResource({
      id: "test.resource",
      middleware: [
        middleware,
        // @ts-expect-error
        middlewareWithConfig,
        middlewareWithConfig.with({ message: "Hello, World!" }),
        // @ts-expect-error
        middlewareWithConfig.with({ message: 123 }),
        middlewareWithOptionalConfig,
        middlewareWithOptionalConfig.with({ message: "Hello, World!" }),
        // @ts-expect-error
        middlewareWithOptionalConfig.with({ message: 123 }),
      ],
      dependencies: { task, dummyResource, event, eventWithoutArguments },
      init: async (_, deps) => {
        const result = await deps.task({
          message: "Hello, World!",
        });

        deps.event({ message: "Hello, World!" });
        // @ts-expect-error
        deps.event();
        // @ts-expect-error
        deps.event({ messagex: "Hello, World!" });
        deps.eventWithoutArguments();
        deps.eventWithoutArguments({});
        // @ts-expect-error
        deps.eventWithoutArguments({ something: false });

        // @ts-expect-error
        deps.dummyResource as number;

        deps.dummyResource as string;

        // @ts-expect-error
        result === 1;

        // @ts-expect-error
        deps.task2;
      },
      register: [
        middleware,
        middlewareWithConfig,
        middlewareWithOptionalConfig,
        middlewareWithOptionalConfig.with({ message: "Hello, World!" }),
        middlewareWithConfig.with({ message: "Hello, World!" }),
        // @ts-expect-error
        middlewareWithConfig.with({ message: 123 }),
        dummyResourceNoConfig,
        // @ts-expect-error
        dummyResourceNoConfig.with("hello"),
        // @ts-expect-error
        dummyResourceNoConfig.with({ anyObject: true }),

        // @ts-expect-error
        dummyResource, // should throw
        dummyResource.with({ ok: true }),
        // @ts-expect-error
        dummyResource.with({ ok: 123 }),
        // @ts-expect-error
        dummyResource.with(),

        // should work
        dummyResourceOptionalConfig.with("hello"),
      ],
    });

    expect(true).toBe(true);
  });

  it("events: should have propper type safety", async () => {
    const hookEvent = defineEvent<{ message: string }>({ id: "hook.event" });

    const task = defineTask({
      id: "task",
      run: async () => "Task executed",
    });

    const testResource = defineTask({
      id: "test.resource",
      dependencies: { task },
      on: hookEvent,
      run: async (_, deps) => {
        _.data.message;
        // @ts-expect-error
        _.data.messagex;
        deps.task();
        // @ts-expect-error
        deps.task2;
      },
    });

    const testResource2 = defineTask({
      id: "test.resource",
      dependencies: { task },
      on: "*",
      run: async (_, deps) => {
        _.data.message;
        _.data.messagex;
        deps.task();
        // @ts-expect-error
        deps.task2;
      },
    });

    expect(true).toBe(true);
  });
});
