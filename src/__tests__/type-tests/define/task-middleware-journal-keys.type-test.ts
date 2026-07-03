import z from "zod";
import { journal } from "../../../";
import { defineTaskMiddleware } from "../../../define";

// Type-only tests for task middleware journal key inference in direct definers.

{
  const attemptKey = journal.createKey<number>(
    "type-tests.define.task-middleware.journal.attempt",
  );

  const middleware = defineTaskMiddleware({
    id: "define-journal-keys-explicit-config",
    configSchema: {
      parse: (value: unknown): { enabled: boolean } =>
        value as { enabled: boolean },
    },
    journal: {
      attempt: attemptKey,
    },
    run: async ({ next }, _deps, config) => {
      config.enabled;
      return next();
    },
  });

  const typedAttemptKey: typeof attemptKey = middleware.journalKeys.attempt;
  void typedAttemptKey;

  // @ts-expect-error undeclared journal keys must not appear on the middleware
  middleware.journalKeys.missing;
}

{
  const traceIdKey = journal.createKey<string>(
    "type-tests.define.task-middleware.journal.traceId",
  );

  const middleware = defineTaskMiddleware({
    id: "define-journal-keys-schema",
    configSchema: z.object({ ttl: z.number().positive() }),
    journal: {
      traceId: traceIdKey,
    },
    run: async ({ next }, _deps, config) => {
      config.ttl.toFixed();
      return next();
    },
  });

  const typedTraceIdKey: typeof traceIdKey = middleware.journalKeys.traceId;
  void typedTraceIdKey;

  // @ts-expect-error undeclared journal keys must not appear on the middleware
  middleware.journalKeys.missing;
}

{
  const activeKey = journal.createKey<boolean>(
    "type-tests.define.task-middleware.journal.explicit.active",
  );

  // @ts-expect-error explicit config generics cannot also infer journal keys;
  // use the inferred/schema path or the fluent builder instead.
  const middleware = defineTaskMiddleware<{ enabled: boolean }>({
    id: "define-journal-keys-explicit-generic",
    journal: {
      active: activeKey,
    },
    run: async ({ next }, _deps, config) => {
      config.enabled.valueOf();
      return next();
    },
  });
  void middleware;
}
