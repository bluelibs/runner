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

// Scenario: raw Match patterns should infer directly in fluent schema APIs.
{
  r.task("types-schema-task-match-pattern")
    .inputSchema({
      id: String,
      retries: Match.Optional(Match.Integer),
    })
    .resultSchema({
      ok: Boolean,
    })
    .run(async (input) => {
      input.id.toUpperCase();
      if (input.retries !== undefined) {
        input.retries.toFixed();
      }
      // @ts-expect-error raw Match pattern should stay strict
      input.extra;

      return { ok: true };
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
    .schema({ parse: (x: any): { requestId: string } => x })
    .build();

  void requestContext.provide({ requestId: "r-1" }, async () => {
    const value = requestContext.use();
    value.requestId;
    // @ts-expect-error property does not exist on context value
    value.invalid;
  });

  const AppError = r
    .error<{ code: number }>("types-schema-error")
    .schema({ parse: (x: any): { code: number } => x })
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

// Scenario: raw Match patterns should infer for event/tag/asyncContext aliases.
{
  const event = r
    .event("types-schema-event-match-pattern")
    .schema({ name: String })
    .build();

  r.hook("types-schema-hook-match-pattern")
    .on(event)
    .run(async (emission) => {
      emission.data.name.toUpperCase();
      // @ts-expect-error raw Match payload should stay strict
      emission.data.other;
    })
    .build();

  const requestContext = r
    .asyncContext("types-schema-ctx-match-pattern")
    .schema({ requestId: String })
    .build();

  void requestContext.provide({ requestId: "r-2" }, async () => {
    requestContext.use().requestId.toUpperCase();
  });

  const AppError = r
    .error("types-schema-error-match-pattern")
    .schema({ code: Number })
    .build();

  AppError.throw({ code: 1 });
  // @ts-expect-error raw Match error schema should stay strict
  AppError.throw({ code: "1" });

  const featureTag = r
    .tag("types-schema-tag-match-pattern")
    .schema({ scope: String })
    .build();

  featureTag.with({ scope: "core" });
  // @ts-expect-error raw Match tag schema should stay strict
  featureTag.with({ scope: 1 });
}

// Scenario: compiled Match schemas should preserve their inferred payloads in fluent APIs.
{
  const compiledTaskInput = Match.compile({
    id: String,
    enabled: Boolean,
  });
  const compiledTaskResult = Match.compile({
    ok: Boolean,
  });

  r.task("types-schema-task-compiled-match")
    .inputSchema(compiledTaskInput)
    .resultSchema(compiledTaskResult)
    .run(async (input) => {
      input.id.toUpperCase();
      const enabled: boolean = input.enabled;
      void enabled;
      // @ts-expect-error compiled Match input should stay strict
      input.missing;
      return { ok: true };
    })
    .build();

  const compiledMiddlewareSchema = Match.compile({
    ttl: Number,
  });

  r.middleware
    .task("types-schema-task-middleware-compiled-match")
    .configSchema(compiledMiddlewareSchema)
    .run(async ({ next, task }, _deps, config) => {
      config.ttl.toFixed();
      // @ts-expect-error compiled Match middleware config should stay strict
      config.missing;
      return next(task.input);
    })
    .build();

  const compiledEventSchema = Match.compile({
    name: String,
  });

  const event = r
    .event("types-schema-event-compiled-match")
    .payloadSchema(compiledEventSchema)
    .build();

  r.hook("types-schema-hook-compiled-match")
    .on(event)
    .run(async (emission) => {
      emission.data.name.toUpperCase();
      // @ts-expect-error compiled Match event payload should stay strict
      emission.data.invalid;
    })
    .build();
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
