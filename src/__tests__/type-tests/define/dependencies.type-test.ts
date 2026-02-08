import {
  defineEvent,
  defineResource,
  defineResourceMiddleware,
  defineTask,
  defineTaskMiddleware,
} from "../../../define";

// Type-only tests for define dependencies and registration typing.

// Scenario: tasks/resources should enforce dependency and registration contracts.
{
  type InputTask = {
    message: string;
  };

  const middlewareTaskOnly = defineTaskMiddleware({
    id: "middleware",
    run: async (input) => {
      return input;
    },
  });

  type MiddlewareConfig = {
    message: string;
  };

  type MiddlewareOptionalConfig = {
    message?: string;
  };

  const middlewareWithConfig = defineTaskMiddleware({
    id: "middleware.config",
    run: async (input, deps, config: MiddlewareConfig) => {
      return input;
    },
  });

  const middlewareWithOptionalConfig = defineTaskMiddleware({
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

  defineResource({
    id: "test.resource",
    middleware: [],
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
      middlewareTaskOnly,
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
      dummyResourceOptionalConfig.with("hello"),
    ],
  });
}

// Scenario: middleware config requirements should be enforced for tasks/resources.
{
  const mw = defineTaskMiddleware<void, { input: string }, { output: number }>({
    id: "middleware",
    run: async ({ next, task }) => {
      task.input;
      task.input.input;
      // @ts-expect-error
      task.input.a;
      next({ input: "123" });
      // @ts-expect-error
      next({ input: 123 });
      const outputResult = await next({ input: "123" });
      outputResult.output;
      // @ts-expect-error
      outputResult.output2;

      return {
        output: 123,
      };
    },
  });
  const mwWithConfig = defineTaskMiddleware<
    { ttl: number },
    { input: string },
    { output: number }
  >({
    id: "middleware",
    run: async ({ next }) => {
      return {
        output: 123,
      };
    },
  });

  const mwr = defineResourceMiddleware<
    void,
    { input: string },
    { output: number }
  >({
    id: "middleware",
    run: async () => {},
  });

  const mwrWithConfig = defineResourceMiddleware<
    { ttl: number },
    { input: string },
    { output: number }
  >({
    id: "middleware",
    run: async () => {},
  });

  const mwr2 = defineResourceMiddleware<void, { input: string }, void>({
    id: "middleware2",
    run: async () => {},
  });

  defineTask({
    id: "task",
    middleware: [mw],
    // @ts-expect-error
    run: async (input) => {
      input;
      // @ts-expect-error
      input.a;

      return {
        output: "str",
      };
    },
  });

  defineResource<{ input: string }>({
    id: "resource",
    middleware: [mwr, mwr2],
    init: async (config) => {
      config.input;
      // @ts-expect-error
      config.input2;

      return {
        output: 123,
      };
    },
  });

  defineTask({
    id: "task",
    middleware: [
      // @ts-expect-error
      mwWithConfig,
      mwWithConfig.with({ ttl: 123 }),
      // @ts-expect-error
      mwWithConfig.with({ ttl: "123" }),
    ],
    run: async (input) => {
      input;
      // @ts-expect-error
      input.a;

      return {
        output: 123,
      };
    },
  });

  defineResource<{ input: string }>({
    id: "resource",
    middleware: [
      // @ts-expect-error
      mwrWithConfig,
      mwrWithConfig.with({ ttl: 123 }),
      // @ts-expect-error
      mwrWithConfig.with({ ttl: "123" }),
    ],
    init: async (config) => {
      config.input;
    },
  });
}
