import { defineTask, defineTaskMiddleware } from "../../define";
import { journal, r, run } from "../../index";

describe("task middleware journal keys", () => {
  it("exposes declared journal keys on the base and configured middleware", () => {
    const attemptKey = journal.createKey<number>("attempt");
    const errorKey = journal.createKey<Error | undefined>("error");

    const middleware = defineTaskMiddleware({
      id: "tests-middleware-journal-keys-direct",
      configSchema: {
        parse: (value: unknown): { enabled: boolean } =>
          value as { enabled: boolean },
      },
      journal: {
        attempt: attemptKey,
        error: errorKey,
      },
      run: async ({ next }) => next(),
    });

    const configured = middleware.with({ enabled: true });
    const executionJournal = journal.create();

    expect(middleware.journalKeys.attempt).toBe(attemptKey);
    expect(middleware.journalKeys.error).toBe(errorKey);
    expect(middleware.journalKeys.attempt.id).toBe("attempt");
    expect(middleware.journalKeys.error.id).toBe("error");
    expect(configured.journalKeys).toBe(middleware.journalKeys);
    expect("journal" in middleware).toBe(false);
    expect("journal" in configured).toBe(false);

    executionJournal.set(attemptKey, 3);
    executionJournal.set(errorKey, undefined, { override: true });

    expect(executionJournal.get(middleware.journalKeys.attempt)).toBe(3);
    expect(executionJournal.get(middleware.journalKeys.error)).toBeUndefined();
  });

  it("fails fast when a declared journal key is invalid", () => {
    expect(() =>
      defineTaskMiddleware({
        id: "tests-middleware-journal-keys-invalid",
        journal: {
          bad: { id: 123 } as any,
        },
        run: async ({ next }) => next(),
      }),
    ).toThrow(/journal key "bad" must be created via journal\.createKey/i);
  });

  it("allows distinct journal keys to reuse the same id without sharing", () => {
    const first = journal.createKey<string>("shared-id");
    const second = journal.createKey<number>("shared-id");
    const executionJournal = journal.create();

    const middleware = defineTaskMiddleware({
      id: "tests-middleware-journal-keys-duplicate",
      journal: {
        first,
        second,
      },
      run: async ({ next }) => next(),
    });

    executionJournal.set(middleware.journalKeys.first, "value");

    expect(executionJournal.get(middleware.journalKeys.second)).toBeUndefined();
  });

  it("fails fast when a declared journal key id is empty", () => {
    expect(() =>
      defineTaskMiddleware({
        id: "tests-middleware-journal-keys-empty-id",
        journal: {
          empty: journal.createKey<string>(""),
        },
        run: async ({ next }) => next(),
      }),
    ).toThrow(/Journal key "empty" must have a non-empty id/i);
  });

  it("merges and overrides builder journal declarations by property name", () => {
    const hitKey = journal.createKey<boolean>("hit");
    const refsKey = journal.createKey<string | undefined>("refs");
    const activeKey = journal.createKey<number>("active");

    const merged = r.middleware
      .task("tests-builder-middleware-journal-merged")
      .journal({ hit: hitKey })
      .journal({ refs: refsKey })
      .run(async ({ next, task, journal }) => {
        journal.set(merged.journalKeys.hit, true, { override: true });
        journal.set(merged.journalKeys.refs, task.definition.id, {
          override: true,
        });
        return next(task.input);
      })
      .build();

    const overridden = r.middleware
      .task("tests-builder-middleware-journal-overridden")
      .journal({ hit: hitKey })
      .journal({ active: activeKey }, { override: true })
      .run(async ({ next }) => next())
      .build();

    const typedHitKey: typeof hitKey = merged.journalKeys.hit;
    const typedRefsKey: typeof refsKey = merged.journalKeys.refs;
    void typedHitKey;
    void typedRefsKey;

    expect(merged.journalKeys.hit.id).toBe("hit");
    expect(merged.journalKeys.refs.id).toBe("refs");
    expect(overridden.journalKeys.active.id).toBe("active");
  });

  it("supports runtime use of custom middleware journal keys", async () => {
    const seenTraceIds: string[] = [];

    const traceWriter = r.middleware
      .task<{ prefix: string }>("tests-middleware-journal-keys-trace-writer")
      .journal({
        traceId: journal.createKey<string>("traceId"),
      })
      .run(async ({ task, next, journal }, _deps, config) => {
        journal.set(
          traceWriter.journalKeys.traceId,
          `${config.prefix}:${task.definition.id}`,
          { override: true },
        );
        return next(task.input);
      })
      .build();

    const traceReader = defineTaskMiddleware({
      id: "tests-middleware-journal-keys-trace-reader",
      run: async ({ task, next, journal }) => {
        const result = await next(task.input);
        const traceId = journal.get(traceWriter.journalKeys.traceId);

        if (traceId) {
          seenTraceIds.push(traceId);
        }

        return result;
      },
    });

    const task = defineTask({
      id: "tests-middleware-journal-keys-task",
      middleware: [traceReader, traceWriter.with({ prefix: "trace" })],
      run: async () => "ok",
    });

    const app = r
      .resource("tests-middleware-journal-keys-app")
      .register([traceWriter, traceReader, task])
      .build();

    const runtime = await run(app);

    try {
      await expect(runtime.runTask(task)).resolves.toBe("ok");
      expect(seenTraceIds).toEqual([
        "trace:tests-middleware-journal-keys-app.tasks.tests-middleware-journal-keys-task",
      ]);
      expect(traceWriter.with({ prefix: "again" }).journalKeys).toBe(
        traceWriter.journalKeys,
      );
    } finally {
      await runtime.dispose();
    }
  });

  it("isolates local journal key ids across different middleware definitions", async () => {
    const firstMiddleware = defineTaskMiddleware({
      id: "tests-middleware-journal-keys-first",
      journal: {
        active: journal.createKey<boolean>("active"),
      },
      run: async ({ task, next, journal: executionJournal }) => {
        executionJournal.set(firstMiddleware.journalKeys.active, true, {
          override: true,
        });
        return next(task.input);
      },
    });

    const secondMiddleware = defineTaskMiddleware({
      id: "tests-middleware-journal-keys-second",
      journal: {
        active: journal.createKey<boolean>("active"),
      },
      run: async ({ task, next, journal: executionJournal }) => {
        executionJournal.set(secondMiddleware.journalKeys.active, false, {
          override: true,
        });
        return next(task.input);
      },
    });

    const task = defineTask({
      id: "tests-middleware-journal-keys-isolated-task",
      middleware: [firstMiddleware, secondMiddleware],
      run: async (_input: void, _deps, context) => {
        return {
          first: context!.journal.get(firstMiddleware.journalKeys.active),
          second: context!.journal.get(secondMiddleware.journalKeys.active),
        };
      },
    });

    const app = r
      .resource("tests-middleware-journal-keys-isolated-app")
      .register([firstMiddleware, secondMiddleware, task])
      .build();

    const runtime = await run(app);

    try {
      await expect(runtime.runTask(task)).resolves.toEqual({
        first: true,
        second: false,
      });
    } finally {
      await runtime.dispose();
    }
  });

  it("shares state when middleware reuse the same journal key object", async () => {
    const sharedTraceKey = journal.createKey<string>("traceId");
    const seenTraceIds: string[] = [];

    const traceWriter = defineTaskMiddleware({
      id: "tests-middleware-journal-shared-writer",
      journal: {
        traceId: sharedTraceKey,
      },
      run: async ({ task, next, journal: executionJournal }) => {
        executionJournal.set(sharedTraceKey, String(task.definition.id), {
          override: true,
        });
        return next(task.input);
      },
    });

    const traceReader = defineTaskMiddleware({
      id: "tests-middleware-journal-shared-reader",
      journal: {
        traceId: sharedTraceKey,
      },
      run: async ({ task, next, journal: executionJournal }) => {
        const result = await next(task.input);
        const traceId = executionJournal.get(traceReader.journalKeys.traceId);

        if (traceId) {
          seenTraceIds.push(traceId);
        }

        return result;
      },
    });

    const task = defineTask({
      id: "tests-middleware-journal-shared-task",
      middleware: [traceReader, traceWriter],
      run: async () => "ok",
    });

    const app = r
      .resource("tests-middleware-journal-shared-app")
      .register([traceWriter, traceReader, task])
      .build();

    const runtime = await run(app);

    try {
      await expect(runtime.runTask(task)).resolves.toBe("ok");
      expect(seenTraceIds).toEqual([
        "tests-middleware-journal-shared-app.tasks.tests-middleware-journal-shared-task",
      ]);
    } finally {
      await runtime.dispose();
    }
  });
});
