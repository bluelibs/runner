import { r } from "../../..";

// Type-only tests for r.override(base, run/init).
{
  const baseTask = r
    .task("types-override-shorthand-task")
    .run(async (input: { value: number }) => input.value)
    .build();

  // @ts-expect-error
  r.override(baseTask);

  r.override(baseTask, async (input) => input.value + 1);

  // @ts-expect-error
  r.override(baseTask, async () => "invalid");
  // @ts-expect-error
  r.override(baseTask, {
    run: async (input: { value: number }) => input.value,
  });
}

{
  const suffixTask = r
    .task("types-override-shorthand-resource-suffix")
    .run(async () => "7")
    .build();

  const baseResource = r
    .resource<{ prefix: string }>("types-override-shorthand-resource")
    .dependencies({ suffix: suffixTask })
    .context(() => ({ disposed: false, marker: "base" }))
    .init(async (config, { suffix }, context) => {
      context.marker = config.prefix;
      return Number(await suffix());
    })
    .build();

  r.override(baseResource, async () => 456);
  r.override(baseResource, {
    context: () => ({ disposed: false, marker: "override" }),
    init: async (_config, { suffix }, context) => {
      context.marker = "patched";
      return Number(await suffix());
    },
    ready: async (value, _config, _deps, context) => {
      value.toFixed();
      context.marker.length;
    },
    cooldown: async (_value, _config, _deps, context) => {
      context.disposed = true;
    },
    dispose: async (_value, _config, _deps, context) => {
      context.disposed = true;
    },
  });

  // @ts-expect-error
  r.override(baseResource, async () => "invalid");
  // @ts-expect-error
  r.override(baseResource, {});
  // @ts-expect-error
  r.override(baseResource, { health: async () => ({ status: "healthy" }) });
  // @ts-expect-error
  r.override(baseResource, { dispose: "later" });
  // @ts-expect-error
  r.override(baseResource, {
    ready: async (value: string) => {
      return value;
    },
  });
}

{
  const event = r
    .event("types-override-shorthand-hook-event")
    .payloadSchema<{ id: string }>({ parse: (v) => v as { id: string } })
    .build();

  const baseHook = r
    .hook("types-override-shorthand-hook")
    .on(event)
    .run(async (emission) => emission.data.id.length)
    .build();

  r.override(baseHook, async (emission) => emission.data.id.length + 1);

  // @ts-expect-error
  r.override(baseHook, async (emission: { data: { id: number } }) => {
    return emission.data.id;
  });
  // @ts-expect-error
  r.override(baseHook, { run: async (emission) => emission.data.id.length });
}

{
  const baseTaskMiddleware = r.middleware
    .task("types-override-shorthand-middleware-task")
    .run(async ({ next }) => next())
    .build();

  r.override(baseTaskMiddleware, async ({ next }) => next());

  // @ts-expect-error
  r.override(baseTaskMiddleware, async (input: string) => input);
  // @ts-expect-error
  r.override(baseTaskMiddleware, { run: async ({ next }) => next() });
}

{
  const baseResourceMiddleware = r.middleware
    .resource("types-override-shorthand-middleware-resource")
    .run(async ({ next }) => next())
    .build();

  r.override(baseResourceMiddleware, async ({ next }) => next());

  // @ts-expect-error
  r.override(baseResourceMiddleware, async (input: string) => input);
  // @ts-expect-error
  r.override(baseResourceMiddleware, { run: async ({ next }) => next() });
}
