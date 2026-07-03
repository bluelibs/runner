import { defineTaskMiddleware, journal, r } from "../../../";

// Type-only tests for task middleware journal key declarations.

// Scenario: direct defineTaskMiddleware should preserve declared journal keys.
{
  const traceIdKey = journal.createKey<string>(
    "types.taskMiddleware.journal.direct.traceId",
  );

  const middleware = defineTaskMiddleware({
    id: "types-task-middleware-journal-direct",
    journal: {
      traceId: traceIdKey,
    },
    configSchema: { parse: (value: any): { enabled: boolean } => value },
    run: async ({ next, journal }, _deps, config) => {
      config.enabled;
      journal.get(middleware.journalKeys.traceId)?.toUpperCase();
      return next();
    },
  });

  const typedTraceIdKey: typeof traceIdKey = middleware.journalKeys.traceId;
  void typedTraceIdKey;

  middleware.with({ enabled: true });
  // @ts-expect-error middleware config should remain strict
  middleware.with({ enabled: "yes" });
}

// Scenario: schema-based defineTaskMiddleware should preserve typed journal keys.
{
  const attemptKey = journal.createKey<number>(
    "types.taskMiddleware.journal.schema.attempt",
  );

  const middleware = defineTaskMiddleware({
    id: "types-task-middleware-journal-schema",
    configSchema: { parse: (value: any): { ttl: number } => value },
    journal: {
      attempt: attemptKey,
    },
    run: async ({ next, journal }, _deps, config) => {
      config.ttl.toFixed();
      journal.get(middleware.journalKeys.attempt)?.toFixed();
      return next();
    },
  });

  const typedAttemptKey: typeof attemptKey = middleware.journalKeys.attempt;
  void typedAttemptKey;
}

// Scenario: fluent builder chaining through dependencies, tags, configSchema,
// and schema should preserve typed journal keys.
{
  const middlewareTag = r
    .tag("types-task-middleware-journal-tag")
    .for("taskMiddlewares")
    .build();
  const traceKey = journal.createKey<string>(
    "types.taskMiddleware.journal.builder.traceId",
  );
  const hitKey = journal.createKey<boolean>(
    "types.taskMiddleware.journal.builder.hit",
  );

  const configured = r.middleware
    .task("types-task-middleware-journal-builder-configSchema")
    .journal({ traceId: traceKey })
    .dependencies({})
    .tags([middlewareTag])
    .configSchema({ parse: (value: any): { prefix: string } => value })
    .run(async ({ next, journal }, _deps, config) => {
      config.prefix.toUpperCase();
      journal.get(configured.journalKeys.traceId)?.toUpperCase();
      // @ts-expect-error property does not exist on schema-derived config
      config.missing;
      return next();
    })
    .build();

  const aliased = r.middleware
    .task("types-task-middleware-journal-builder-schema")
    .journal({ hit: hitKey })
    .schema({ parse: (value: any): { ttl: number } => value })
    .run(async ({ next, journal }, _deps, config) => {
      config.ttl.toFixed();
      journal.get(aliased.journalKeys.hit)?.valueOf();
      // @ts-expect-error property does not exist on schema-derived config
      config.extra;
      return next();
    })
    .build();

  const typedTraceKey: typeof traceKey = configured.journalKeys.traceId;
  const typedHitKey: typeof hitKey = aliased.journalKeys.hit;
  void typedTraceKey;
  void typedHitKey;
}
