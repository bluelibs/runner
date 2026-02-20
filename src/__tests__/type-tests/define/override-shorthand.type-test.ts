import { r } from "../../..";

// Type-only tests for r.override(base, run/init).
{
  const baseTask = r
    .task("types.override.shorthand.task")
    .run(async (input: { value: number }) => input.value)
    .build();

  r.override(baseTask, async (input) => input.value + 1);

  // @ts-expect-error
  r.override(baseTask, async () => "invalid");
}

{
  const baseResource = r
    .resource("types.override.shorthand.resource")
    .init(async () => 123)
    .build();

  r.override(baseResource, async () => 456);

  // @ts-expect-error
  r.override(baseResource, async () => "invalid");
}

{
  const event = r
    .event("types.override.shorthand.hook.event")
    .payloadSchema<{ id: string }>({ parse: (v) => v as { id: string } })
    .build();

  const baseHook = r
    .hook("types.override.shorthand.hook")
    .on(event)
    .run(async (emission) => emission.data.id.length)
    .build();

  r.override(baseHook, async (emission) => emission.data.id.length + 1);

  // @ts-expect-error
  r.override(baseHook, async (emission: { data: { id: number } }) => {
    return emission.data.id;
  });
}

{
  const baseTaskMiddleware = r.middleware
    .task("types.override.shorthand.middleware.task")
    .run(async ({ next }) => next())
    .build();

  r.override(baseTaskMiddleware, async ({ next }) => next());

  // @ts-expect-error
  r.override(baseTaskMiddleware, async (input: string) => input);
}

{
  const baseResourceMiddleware = r.middleware
    .resource("types.override.shorthand.middleware.resource")
    .run(async ({ next }) => next())
    .build();

  r.override(baseResourceMiddleware, async ({ next }) => next());

  // @ts-expect-error
  r.override(baseResourceMiddleware, async (input: string) => input);
}
