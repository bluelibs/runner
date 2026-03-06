import { Match, r } from "../../../";

class DecoratedSchema {
  scope!: string;
}

Match.Schema()(DecoratedSchema);
Match.Field(String)(DecoratedSchema.prototype, "scope");

// Type-only tests for fluent `.schema()` aliases.

// Scenario: task entry generic should seed input typing.
{
  r.task<{ id: string }>("types-schema-task-entry-generic")
    .run(async (input) => {
      input.id;
      // @ts-expect-error property does not exist on entry-generic input
      input.missing;
      return { ok: true as const };
    })
    .build();
}

// Scenario: later schema typing should override earlier entry generic typing.
{
  r.task<{ seeded: number }>("types-schema-task-entry-precedence")
    .schema<{ fromSchema: string }>({ parse: (x: any) => x })
    .run(async (input) => {
      input.fromSchema;
      // @ts-expect-error schema typing should replace seeded typing
      input.seeded;
      return input.fromSchema;
    })
    .build();
}

// Scenario: resource entry generic should type config usage even without init.
{
  const child = r.resource("types-schema-resource-entry-generic-child").build();

  r.resource<{ enabled: boolean }>("types-schema-resource-entry-generic")
    .register((config) => {
      config.enabled;
      // @ts-expect-error property does not exist on entry-generic config
      config.unknown;
      return config.enabled ? [child] : [];
    })
    .build();
}

// Scenario: task middleware single generic should seed config typing.
{
  const mw = r.middleware
    .task<{ requiresAuth: boolean }>(
      "types-schema-middleware-task-entry-generic",
    )
    .run(async ({ next, task }, _deps, config) => {
      config.requiresAuth;
      // @ts-expect-error property does not exist on middleware config
      config.missing;
      return next(task.input);
    })
    .build();

  mw.with({ requiresAuth: true });
  // @ts-expect-error config type must remain strict for .with()
  mw.with({ requiresAuth: "yes" });
}

// Scenario: task middleware explicit second generic should seed input contract typing.
{
  r.middleware
    .task<{ requiresAuth: boolean }, { user: { id: string } }>(
      "types-schema-middleware-task-entry-generic-input-contract",
    )
    .run(async ({ next, task }, _deps, config) => {
      config.requiresAuth;
      task.input.user.id;
      // @ts-expect-error property does not exist on middleware input contract
      task.input.user.missing;
      return next(task.input);
    })
    .build();
}

// Scenario: resource middleware entry generic should type middleware config.
{
  r.middleware
    .resource<{ retries: number }>(
      "types-schema-middleware-resource-entry-generic",
    )
    .run(async ({ next }, _deps, config) => {
      config.retries;
      // @ts-expect-error property does not exist on middleware config
      config.missing;
      return next();
    })
    .build();
}

// Scenario: task.schema should map to task input schema typing.
{
  r.task("types-schema-task")
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
    .event("types-schema-event")
    .schema<{ name: string }>({ parse: (x: any) => x })
    .build();

  r.resource("types-schema-resource")
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

  r.hook("types-schema-hook")
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
    .task("types-schema-task-middleware")
    .schema<{ ttl: number }>({ parse: (x: any) => x })
    .run(async ({ next, task }, _deps, config) => {
      config.ttl;
      // @ts-expect-error property does not exist on schema-derived config
      config.invalid;
      return next(task.input);
    })
    .build();

  r.middleware
    .resource("types-schema-resource-middleware")
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
    .asyncContext<{ requestId: string }>("types-schema-ctx")
    .schema({ parse: (x: any) => x })
    .build();

  void requestContext.provide({ requestId: "r-1" }, async () => {
    const value = requestContext.use();
    value.requestId;
    // @ts-expect-error property does not exist on context value
    value.invalid;
  });

  const AppError = r
    .error<{ code: number }>("types-schema-error")
    .schema({ parse: (x: any) => x })
    .build();

  AppError.throw({ code: 1 });
  // @ts-expect-error schema enforces error data shape
  AppError.throw({ invalid: true });

  const featureTag = r
    .tag<{ scope: string }>("types-schema-tag")
    .schema<{ scope: string }>({ parse: (x: any) => x })
    .build();

  featureTag.with({ scope: "core" });
  // @ts-expect-error schema enforces tag config shape
  featureTag.with({ scope: 1 });
}

// Scenario: decorator class shorthand should be accepted in fluent schema APIs.
{
  r.task("types-schema-decorator-task")
    .schema(DecoratedSchema)
    .run(async (input) => {
      input.scope;
      // @ts-expect-error decorator shorthand should infer decorated fields only
      input.missing;
      return input.scope;
    })
    .build();

  const decoratedTag = r
    .tag<{ scope: string }>("types-schema-decorator-tag")
    .configSchema(DecoratedSchema)
    .build();

  decoratedTag.with({ scope: "x" });
  // @ts-expect-error config should remain strict with class shorthand schema
  decoratedTag.with({ scope: 5 });
}
