import { r } from "../../../";

// Type-only tests for builder dependency and registration typing.

// Scenario: builder API should enforce dependency signatures and registrations.
{
  type InputTask = {
    message: string;
  };

  const middlewareTaskOnly = r.middleware
    .task("middleware")
    .run(async ({ task }) => {
      return task.input;
    })
    .build();

  type MiddlewareConfig = {
    message: string;
  };

  type MiddlewareOptionalConfig = {
    message?: string;
  };

  const middlewareWithConfig = r.middleware
    .task("middleware.config")
    .configSchema<MiddlewareConfig>({ parse: (x: any) => x })
    .run(async ({ next }, _deps, _config: MiddlewareConfig) => {
      return next();
    })
    .build();

  const middlewareWithOptionalConfig = r.middleware
    .task("middleware.optional.config")
    .configSchema<MiddlewareOptionalConfig>({ parse: (x: any) => x })
    .run(async ({ next }, _deps, _config: MiddlewareOptionalConfig) => {
      return next();
    })
    .build();

  const middlewareWithExplicitContracts = r.middleware
    .task<MiddlewareConfig, { message: string }, { ok: true }>(
      "middleware.explicit.contracts",
    )
    .run(async ({ next, task }, _deps, config) => {
      config.message;
      task.input.message;
      const result = await next(task.input);
      result.ok;
      return result;
    })
    .build();

  const event = r
    .event("event")
    .payloadSchema<{ message: string }>({ parse: (x: any) => x })
    .build();

  const eventWithoutArguments = r.event("event.noargs").build();

  const baseTask = r
    .task("task.base")
    .inputSchema<InputTask>({ parse: (x: any) => x })
    .run(async (_input: InputTask) => "Task executed")
    .build();

  const task = r
    .task("task")
    .dependencies({ baseTask, event })
    .inputSchema<InputTask>({ parse: (x: any) => x })
    .run(async (input, deps) => {
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
    })
    .build();

  type ResourceType = {
    ok: boolean;
  };

  const dummyResource = r
    .resource<ResourceType>("dummy.resource")
    .configSchema<ResourceType>({ parse: (x: any) => x })
    .init(async (_config: ResourceType) => "Resource Value")
    .build();

  const dummyResourceNoConfig = r
    .resource("dummy.resource.noconfig")
    .init(async () => "Resource Value")
    .build();

  const dummyResourceOptionalConfig = r
    .resource<string | undefined>("dummy.resource.optional.config")
    .configSchema<string | undefined>({ parse: (x: any) => x })
    .init(async (_config?: string) => "Resource Value")
    .build();

  const testResource3 = r
    .resource("test.resource3")
    .init(async (_: { name: string }) => {
      return "OK";
    })
    .build();

  r.resource("test.resource")
    .middleware([])
    .dependencies({ task, dummyResource, event, eventWithoutArguments })
    .register([
      testResource3.with({ name: "Hello, World!" }),
      middlewareTaskOnly,
      middlewareWithConfig,
      middlewareWithOptionalConfig,
      middlewareWithExplicitContracts,
      middlewareWithOptionalConfig.with({ message: "Hello, World!" }),
      middlewareWithConfig.with({ message: "Hello, World!" }),
      // @ts-expect-error
      middlewareWithConfig.with({ message: 123 }),
      dummyResourceNoConfig,
      // @ts-expect-error
      dummyResourceNoConfig.with("hello"),
      // @ts-expect-error
      dummyResourceNoConfig.with({ anyObject: true }),
      // @ts-expect-error should be invalid to register resource requiring config without .with()
      dummyResource,
      dummyResourceOptionalConfig.with("hello"),
    ])
    .build();
}
