import { r } from "../../../";

// Type-only tests for fluent `.schema()` aliases.

// Scenario: task.schema should map to task input schema typing.
{
  r.task("types.schema.task")
    .schema<{ id: string }>({ parse: (x: any) => x })
    .resultSchema<{ ok: true }>({ parse: (x: any) => x })
    .run(async (input) => {
      input.id;
      // @ts-expect-error property does not exist on schema-derived input
      input.missing;
      return { ok: true as const };
    })
    .build();
}

// Scenario: resource/event schema aliases should type config and payload.
{
  const event = r
    .event("types.schema.event")
    .schema<{ name: string }>({ parse: (x: any) => x })
    .build();

  r.resource("types.schema.resource")
    .schema<{ port: number }>({ parse: (x: any) => x })
    .dependencies({ event })
    .init(async (config, deps) => {
      config.port;
      // @ts-expect-error property does not exist on schema-derived config
      config.host;

      await deps.event({ name: "ok" });
      return { port: config.port };
    })
    .build();

  r.hook("types.schema.hook")
    .on(event)
    .run(async (emission) => {
      emission.data.name;
      // @ts-expect-error property does not exist on schema-derived payload
      emission.data.other;
    })
    .build();
}

// Scenario: middleware/schema aliases should type middleware config.
{
  r.middleware
    .task("types.schema.task.middleware")
    .schema<{ ttl: number }>({ parse: (x: any) => x })
    .run(async ({ next, task }, _deps, config) => {
      config.ttl;
      // @ts-expect-error property does not exist on schema-derived config
      config.invalid;
      return next(task.input);
    })
    .build();

  r.middleware
    .resource("types.schema.resource.middleware")
    .schema<{ retries: number }>({ parse: (x: any) => x })
    .run(async ({ next }, _deps, config) => {
      config.retries;
      // @ts-expect-error property does not exist on schema-derived config
      config.unknown;
      return next();
    })
    .build();
}

// Scenario: asyncContext/error/tag schema aliases should remain valid and typed.
{
  const requestContext = r
    .asyncContext<{ requestId: string }>("types.schema.ctx")
    .schema({ parse: (x: any) => x })
    .build();

  void requestContext.provide({ requestId: "r-1" }, async () => {
    const value = requestContext.use();
    value.requestId;
    // @ts-expect-error property does not exist on context value
    value.invalid;
  });

  const AppError = r
    .error<{ code: number }>("types.schema.error")
    .schema({ parse: (x: any) => x })
    .build();

  AppError.throw({ code: 1 });
  // @ts-expect-error schema enforces error data shape
  AppError.throw({ invalid: true });

  const featureTag = r
    .tag<{ scope: string }>("types.schema.tag")
    .schema<{ scope: string }>({ parse: (x: any) => x })
    .build();

  featureTag.with({ scope: "core" });
  // @ts-expect-error schema enforces tag config shape
  featureTag.with({ scope: 1 });
}
