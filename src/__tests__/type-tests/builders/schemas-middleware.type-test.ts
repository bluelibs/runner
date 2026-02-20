import { r } from "../../../";
import z from "zod";

// Type-only tests for builder schema inference and middleware contracts.

// Scenario: schema-driven inference should propagate through builder APIs.
{
  r.task("task")
    .inputSchema(z.object({ name: z.string() }))
    .resultSchema(z.object({ name: z.string() }))
    .run(async (input) => {
      input.name;
      // @ts-expect-error
      input.age;

      return {
        name: "123",
      };
    })
    .build();

  r.middleware
    .task("middleware")
    .configSchema(z.object({ ttl: z.number().positive() }))
    .run(async ({ next }, _deps, config) => {
      config.ttl;
      // @ts-expect-error
      config.ttl2;
      return next();
    })
    .build();

  r.resource("resource")
    .configSchema(z.object({ ttl: z.number().positive() }))
    .init(async (cfg) => {
      cfg.ttl;
      // @ts-expect-error
      cfg.ttl2;
    })
    .build();
}

// Scenario: middleware contracts should constrain next() input and task input types.
{
  type InputType = { id: string };
  type OutputType = { name: string };
  type ConfigType = { ttl: number };

  const mw = r.middleware
    .task<ConfigType, InputType, OutputType>("mw")
    .run(async ({ next }, _deps, _config) => {
      // @ts-expect-error
      next({ id: 123 });
      // @ts-expect-error
      next({ name: "123" });
      return next({ id: "123" });
    })
    .build();

  r.task("t1")
    .inputSchema(z.object({ id: z.string() }))
    .middleware([mw.with({ ttl: 123 })])
    .run(async (input) => {
      input.id;
      // @ts-expect-error
      input.name;
      return { name: "123" };
    })
    .build();
}
