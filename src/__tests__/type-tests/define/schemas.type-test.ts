import z from "zod";
import { Match } from "../../../";
import {
  defineResource,
  defineTask,
  defineTaskMiddleware,
} from "../../../define";

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
      // @ts-expect-error
      config.ttl2;
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
      // @ts-expect-error
      config.other;
      return next();
    },
  });
}
