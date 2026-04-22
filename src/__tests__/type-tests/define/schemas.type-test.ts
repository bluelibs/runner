import z from "zod";
import { defineAsyncContext } from "../../../";
import {
  defineEvent,
  defineResource,
  defineResourceMiddleware,
  defineTag,
  defineTask,
  defineTaskMiddleware,
} from "../../../define";
import { defineError } from "../../../definers/defineError";
import { Match } from "../../../decorators/legacy";

class DecoratedSchema {
  ttl!: number;
}

Match.Schema()(DecoratedSchema);
Match.Field(Number)(DecoratedSchema.prototype, "ttl");

// Type-only tests for schema-based inference in define API.

// Scenario: input/result/config schema inference should propagate typed fields.
{
  defineTask({
    id: "task",
    inputSchema: z.object({ name: z.string() }),
    resultSchema: z.object({ name: z.string() }),
    run: async (input) => {
      input.name;
      // @ts-expect-error
      input.age;

      return {
        name: "123",
      };
    },
  });

  defineTaskMiddleware({
    id: "middleware",
    configSchema: z.object({ ttl: z.number().positive() }),
    run: async ({ next }, _deps, config) => {
      config.ttl;
      return next();
    },
  });

  defineResource({
    id: "resource",
    configSchema: z.object({ ttl: z.number().positive() }),
    init: async (cfg) => {
      cfg.ttl;
      // @ts-expect-error
      cfg.ttl2;
    },
  });

  defineTask({
    id: "task-decorator",
    inputSchema: DecoratedSchema,
    run: async (input) => {
      input.ttl;
      // @ts-expect-error
      input.missing;
      return input.ttl;
    },
  });

  defineTaskMiddleware({
    id: "middleware-decorator",
    configSchema: DecoratedSchema,
    run: async ({ next }, _deps, config) => {
      config.ttl;
      return next();
    },
  });
}

// Scenario: raw Match patterns should infer directly in define APIs.
{
  defineTask({
    id: "task-match-pattern",
    inputSchema: {
      id: String,
      retries: Match.Optional(Match.Integer),
    },
    resultSchema: { ok: Boolean },
    run: async (input) => {
      input.id.toUpperCase();
      if (input.retries !== undefined) {
        input.retries.toFixed();
      }
      // @ts-expect-error raw Match task input should stay strict
      input.other;
      return { ok: true };
    },
  });

  defineTaskMiddleware({
    id: "middleware-match-pattern",
    configSchema: { ttl: Number },
    run: async ({ next }, _deps, config) => {
      config.ttl.toFixed();
      return next();
    },
  });

  defineResource({
    id: "resource-match-pattern",
    configSchema: { ttl: Number },
    init: async (cfg) => {
      cfg.ttl.toFixed();
      // @ts-expect-error raw Match resource config should stay strict
      cfg.other;
    },
  });
}

// Scenario: raw Match patterns should infer for remaining define APIs.
{
  const Event = defineEvent({
    id: "event-match-pattern",
    payloadSchema: {
      name: String,
      active: Boolean,
    },
  });

  Event.id;

  const ErrorHelper = defineError({
    id: "error-match-pattern",
    dataSchema: { code: Number },
    format: (data: { code: number }) => String(data.code),
  });

  ErrorHelper.throw({ code: 1 });
  // @ts-expect-error error data should remain strict
  ErrorHelper.throw({ code: "1" });

  const Tag = defineTag({
    id: "tag-match-pattern",
    configSchema: { scope: String },
  });

  Tag.with({ scope: "core" });
  // @ts-expect-error tag config should remain strict
  Tag.with({ scope: 1 });

  const context = defineAsyncContext({
    id: "ctx-match-pattern",
    configSchema: { requestId: String },
  });

  void context.provide({ requestId: "r-1" }, async () => {
    context.use().requestId.toUpperCase();
  });

  defineResourceMiddleware({
    id: "resource-middleware-match-pattern",
    configSchema: { retry: Number },
    run: async ({ next }, _deps, config) => {
      config.retry.toFixed();
      // @ts-expect-error resource middleware config should remain strict
      config.invalid;
      return next();
    },
  });
}

// Scenario: compiled Match schemas should infer through define APIs without widening.
{
  const compiledTaskInput = Match.compile({
    id: String,
    retries: Match.Optional(Match.Integer),
  });
  const compiledTaskResult = Match.compile({
    ok: Boolean,
  });

  defineTask({
    id: "task-compiled-match",
    inputSchema: compiledTaskInput,
    resultSchema: compiledTaskResult,
    run: async (input) => {
      input.id.toUpperCase();
      if (input.retries !== undefined) {
        input.retries.toFixed();
      }
      // @ts-expect-error compiled Match task input should remain strict
      input.other;
      return { ok: true };
    },
  });

  defineEvent({
    id: "event-compiled-match",
    payloadSchema: Match.compile({ name: String }),
  });

  defineResource({
    id: "resource-compiled-match",
    configSchema: Match.compile({ ttl: Number }),
    resultSchema: Match.compile({ ok: Boolean }),
    init: async (config) => {
      config.ttl.toFixed();
      // @ts-expect-error compiled Match resource config should remain strict
      config.invalid;
      return { ok: true };
    },
  });
}
