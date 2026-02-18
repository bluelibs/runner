/* eslint-disable jest/valid-title -- Titles are centralized in enums for consistency across this suite. */
import type { ITask } from "../../defs";
import { r, run } from "../..";

enum SuiteName {
  OverrideBuilder = "override builder",
}

enum TestName {
  Task = "builds overrides for tasks",
  TaskDetails = "covers task override builder methods",
  Resource = "builds overrides for resources",
  ResourceDetails = "covers resource override builder methods",
  Hook = "builds overrides for hooks",
  HookDetails = "covers hook override builder methods",
  TaskMiddleware = "builds overrides for task middleware",
  TaskMiddlewareDetails = "covers task middleware override builder methods",
  ResourceMiddleware = "builds overrides for resource middleware",
  ResourceMiddlewareDetails = "covers resource middleware override builder methods",
  HookOn = "does not expose hook on() in overrides",
  OverrideError = "throws for unsupported override base",
}

enum TaskId {
  DepA = "tests.override.builder.task.dep-a",
  DepB = "tests.override.builder.task.dep-b",
  Base = "tests.override.builder.task.base",
  DetailsBase = "tests.override.builder.task.details.base",
  DetailsDepA = "tests.override.builder.task.details.dep-a",
  DetailsDepB = "tests.override.builder.task.details.dep-b",
  DetailsMiddleware = "tests.override.builder.task.details.middleware",
  DetailsTask = "tests.override.builder.task.details.task",
  HookDep = "tests.override.builder.task.hook.dep",
  ResourceDepA = "tests.override.builder.task.resource.dep-a",
  ResourceDepB = "tests.override.builder.task.resource.dep-b",
  MiddlewareDep = "tests.override.builder.task.middleware.dep",
  WithMiddleware = "tests.override.builder.task.with-middleware",
}

enum ResourceId {
  App = "tests.override.builder.app",
  Base = "tests.override.builder.resource.base",
  HookApp = "tests.override.builder.hook.app",
  ResourceDetails = "tests.override.builder.resource.details",
  ResourceApp = "tests.override.builder.resource.app",
  ResourceWithMiddleware = "tests.override.builder.resource.with-middleware",
}

enum EventId {
  Base = "tests.override.builder.event.base",
  Details = "tests.override.builder.event.details",
}

enum HookId {
  Base = "tests.override.builder.hook.base",
  Details = "tests.override.builder.hook.details",
}

enum MiddlewareId {
  Task = "tests.override.builder.middleware.task",
  TaskDetails = "tests.override.builder.middleware.task.details",
  Resource = "tests.override.builder.middleware.resource",
  ResourceDetails = "tests.override.builder.middleware.resource.details",
}

enum TaskValue {
  DepA = 1,
  DepB = 2,
  Sum = 3,
  Base = 5,
}

enum ResourceValue {
  Base = 7,
  Override = 11,
}

enum TagId {
  Primary = "tests.override.builder.tag.primary",
  Secondary = "tests.override.builder.tag.secondary",
}

enum ErrorId {
  Task = "tests.override.builder.error.task",
  Resource = "tests.override.builder.error.resource",
  Hook = "tests.override.builder.error.hook",
  TaskMiddleware = "tests.override.builder.error.task-middleware",
  ResourceMiddleware = "tests.override.builder.error.resource-middleware",
}

enum MetaKey {
  Label = "label",
}

enum ResultKey {
  Wrapped = "wrapped",
}

describe(SuiteName.OverrideBuilder, () => {
  it(TestName.Task, async () => {
    const depA = r
      .task(TaskId.DepA)
      .run(async () => TaskValue.DepA)
      .build();
    const depB = r
      .task(TaskId.DepB)
      .run(async () => TaskValue.DepB)
      .build();

    const base = r
      .task(TaskId.Base)
      .dependencies({ depA })
      .run(async (_input, { depA }) => depA())
      .build();

    const overrideTask = r
      .override(base)
      .dependencies({ depB })
      .run(async (_input, { depA, depB }) => {
        const [a, b] = await Promise.all([depA(), depB()]);
        return a + b;
      })
      .build();

    expect(overrideTask.id).toBe(base.id);

    const app = r
      .resource(ResourceId.App)
      .register([base, depA, depB])
      .overrides([overrideTask])
      .build();

    const runtime = await run(app);
    await expect(runtime.runTask(base.id)).resolves.toBe(TaskValue.Sum);
    await runtime.dispose();
  });

  it(TestName.TaskDetails, () => {
    const depA = r
      .task(TaskId.DetailsDepA)
      .run(async () => TaskValue.DepA)
      .build();
    const depB = r
      .task(TaskId.DetailsDepB)
      .run(async () => TaskValue.DepB)
      .build();
    const taskMiddleware = r.middleware
      .task(MiddlewareId.TaskDetails)
      .run(async ({ next }) => next())
      .build();
    const tagPrimary = r.tag(TagId.Primary).build();
    const tagSecondary = r.tag(TagId.Secondary).build();
    const errorHelper = r.error(ErrorId.Task).build();
    const inputSchema = {
      parse: (value: unknown) => value,
    };
    const resultSchema = {
      parse: (value: unknown) => value,
    };

    const base = r
      .task(TaskId.DetailsBase)
      .run(async () => TaskValue.Base)
      .build();

    const overrideTask = r
      .override(base)
      .dependencies({ depA })
      .dependencies({ depB }, { override: true })
      .middleware([taskMiddleware])
      .middleware([taskMiddleware], { override: true })
      .tags([tagPrimary])
      .tags([tagSecondary], { override: true })
      .schema(inputSchema)
      .inputSchema(inputSchema)
      .resultSchema(resultSchema)
      .meta({ [MetaKey.Label]: TaskValue.Base } as Record<string, any>)
      .throws([errorHelper])
      .run(async () => TaskValue.Base)
      .build();

    expect(overrideTask.dependencies).toEqual({ depB });
    expect(overrideTask.middleware).toEqual([taskMiddleware]);
    expect(overrideTask.tags).toEqual([tagSecondary]);
    expect(overrideTask.inputSchema).toBe(inputSchema);
    expect(overrideTask.resultSchema).toBe(resultSchema);
    expect(overrideTask.meta).toEqual({ [MetaKey.Label]: TaskValue.Base });
    expect(overrideTask.throws).toEqual([ErrorId.Task]);
  });

  it(TestName.Resource, async () => {
    const base = r
      .resource(ResourceId.Base)
      .init(async () => ResourceValue.Base)
      .build();
    const overrideResource = r
      .override(base)
      .init(async () => ResourceValue.Override)
      .build();

    expect(overrideResource.id).toBe(base.id);

    const app = r
      .resource(ResourceId.ResourceApp)
      .register([base])
      .overrides([overrideResource])
      .build();

    const runtime = await run(app);
    expect(runtime.getResourceValue(base)).toBe(ResourceValue.Override);
    await runtime.dispose();
  });

  it(TestName.ResourceDetails, () => {
    const depA = r
      .task(TaskId.ResourceDepA)
      .run(async () => TaskValue.DepA)
      .build();
    const depB = r
      .task(TaskId.ResourceDepB)
      .run(async () => TaskValue.DepB)
      .build();
    const registerA = r
      .task(TaskId.DetailsTask)
      .run(async () => TaskValue.Base)
      .build();
    const registerB = r
      .task(TaskId.DetailsMiddleware)
      .run(async () => TaskValue.Base)
      .build();
    const tagPrimary = r.tag(TagId.Primary).build();
    const tagSecondary = r.tag(TagId.Secondary).build();
    const errorHelper = r.error(ErrorId.Resource).build();
    const middlewareA = r.middleware
      .resource(MiddlewareId.ResourceDetails)
      .run(async ({ next }) => next())
      .build();
    const middlewareB = r.middleware
      .resource(MiddlewareId.Resource)
      .run(async ({ next }) => next())
      .build();
    const configSchema = {
      parse: (value: unknown) => value,
    };
    const resultSchema = {
      parse: (value: unknown) => value,
    };

    const base = r
      .resource(ResourceId.ResourceDetails)
      .init(async () => ResourceValue.Base)
      .build();
    const overrideTask = r
      .override(registerA)
      .run(async () => TaskValue.Base)
      .build();

    const overrideResource = r
      .override(base)
      .dependencies({ depA })
      .dependencies({ depB }, { override: true })
      .register([registerA])
      .register([registerB], { override: true })
      .middleware([middlewareA])
      .middleware([middlewareB], { override: true })
      .tags([tagPrimary])
      .tags([tagSecondary], { override: true })
      .context(() => ({ [MetaKey.Label]: ResourceValue.Override }))
      .schema(configSchema)
      .configSchema(configSchema)
      .resultSchema(resultSchema)
      .init(async () => ResourceValue.Override)
      .dispose(async () => undefined)
      .meta({ [MetaKey.Label]: ResourceValue.Override } as Record<string, any>)
      .overrides([overrideTask])
      .overrides([overrideTask], { override: true })
      .throws([errorHelper])
      .build();

    expect(overrideResource.dependencies).toEqual({ depB });
    expect(overrideResource.register).toEqual([registerB]);
    expect(overrideResource.middleware).toEqual([middlewareB]);
    expect(overrideResource.tags).toEqual([tagSecondary]);
    expect(overrideResource.context?.()).toEqual({
      [MetaKey.Label]: ResourceValue.Override,
    });
    expect(overrideResource.configSchema).toBe(configSchema);
    expect(overrideResource.resultSchema).toBe(resultSchema);
    expect(overrideResource.meta).toEqual({
      [MetaKey.Label]: ResourceValue.Override,
    });
    expect(overrideResource.overrides).toEqual([overrideTask]);
    expect(overrideResource.throws).toEqual([ErrorId.Resource]);
  });

  it(TestName.Hook, async () => {
    const event = r.event(EventId.Base).build();
    let value = ResourceValue.Base;

    const hook = r
      .hook(HookId.Base)
      .on(event)
      .run(async () => {
        value = ResourceValue.Base;
      })
      .build();

    const overrideHook = r
      .override(hook)
      .run(async () => {
        value = ResourceValue.Override;
      })
      .build();

    const app = r
      .resource(ResourceId.HookApp)
      .register([hook, event])
      .dependencies({ event })
      .init(async (_config, { event }) => {
        await event();
      })
      .overrides([overrideHook])
      .build();

    const runtime = await run(app);
    expect(value).toBe(ResourceValue.Override);
    await runtime.dispose();
  });

  it(TestName.HookDetails, () => {
    const event = r.event(EventId.Details).build();
    const depTask = r
      .task(TaskId.HookDep)
      .run(async () => TaskValue.Base)
      .build();
    const tagPrimary = r.tag(TagId.Primary).build();
    const tagSecondary = r.tag(TagId.Secondary).build();

    const baseHook = r
      .hook(HookId.Details)
      .on(event)
      .run(async () => undefined)
      .build();

    const overrideHook = r
      .override(baseHook)
      .dependencies({ depTask })
      .dependencies({ depTask }, { override: true })
      .tags([tagPrimary])
      .tags([tagSecondary], { override: true })
      .meta({ [MetaKey.Label]: TaskValue.Base } as Record<string, any>)
      .order(TaskValue.DepA)
      .run(async () => undefined)
      .build();

    expect(overrideHook.dependencies).toEqual({ depTask });
    expect(overrideHook.tags).toEqual([tagSecondary]);
    expect(overrideHook.meta).toEqual({ [MetaKey.Label]: TaskValue.Base });
    expect(overrideHook.order).toBe(TaskValue.DepA);
  });

  it("hook override builder supports throws", () => {
    const event = r.event(EventId.Details).build();
    const errorHelper = r.error(ErrorId.Hook).build();

    const baseHook = r
      .hook(HookId.Details)
      .on(event)
      .run(async () => undefined)
      .build();

    const overrideHook = r
      .override(baseHook)
      .throws([errorHelper])
      .run(async () => undefined)
      .build();

    expect(overrideHook.throws).toEqual([ErrorId.Hook]);
  });

  it(TestName.TaskMiddleware, async () => {
    const taskMiddleware = r.middleware
      .task(MiddlewareId.Task)
      .run(async ({ next }) => next())
      .build();

    const overrideTaskMiddleware = r
      .override(taskMiddleware)
      .run(async ({ next }) => {
        const result = await next();
        return { [ResultKey.Wrapped]: result };
      })
      .build();

    const task = r
      .task(TaskId.WithMiddleware)
      .middleware([taskMiddleware])
      .run(async () => TaskValue.Base)
      .build();

    const app = r
      .resource(ResourceId.App)
      .register([task, taskMiddleware])
      .overrides([overrideTaskMiddleware])
      .build();

    const runtime = await run(app);
    await expect(runtime.runTask(task.id)).resolves.toEqual({
      [ResultKey.Wrapped]: TaskValue.Base,
    });
    await runtime.dispose();
  });

  it(TestName.TaskMiddlewareDetails, () => {
    const depTask = r
      .task(TaskId.MiddlewareDep)
      .run(async () => TaskValue.Base)
      .build();
    const tagPrimary = r.tag(TagId.Primary).build();
    const tagSecondary = r.tag(TagId.Secondary).build();
    const configSchema = {
      parse: (value: unknown) => value,
    };

    const baseMiddleware = r.middleware
      .task(MiddlewareId.TaskDetails)
      .run(async ({ next }) => next())
      .build();

    const overrideMiddleware = r
      .override(baseMiddleware)
      .dependencies({ depTask })
      .dependencies({ depTask }, { override: true })
      .schema(configSchema)
      .configSchema(configSchema)
      .tags([tagPrimary])
      .tags([tagSecondary], { override: true })
      .meta({ [MetaKey.Label]: TaskValue.Base } as Record<string, any>)
      .everywhere(true)
      .run(async ({ next }) => next())
      .build();

    expect(overrideMiddleware.dependencies).toEqual({ depTask });
    expect(overrideMiddleware.configSchema).toBe(configSchema);
    expect(overrideMiddleware.tags).toEqual([tagSecondary]);
    expect(overrideMiddleware.meta).toEqual({
      [MetaKey.Label]: TaskValue.Base,
    });
    expect(overrideMiddleware.everywhere).toBe(true);
  });

  it("task middleware override builder supports throws", () => {
    const errorHelper = r.error(ErrorId.TaskMiddleware).build();

    const baseMiddleware = r.middleware
      .task(MiddlewareId.TaskDetails)
      .run(async ({ next }) => next())
      .build();

    const overrideMiddleware = r
      .override(baseMiddleware)
      .throws([errorHelper])
      .run(async ({ next }) => next())
      .build();

    expect(overrideMiddleware.throws).toEqual([ErrorId.TaskMiddleware]);
  });

  it(TestName.ResourceMiddleware, async () => {
    const resourceMiddleware = r.middleware
      .resource(MiddlewareId.Resource)
      .run(async ({ next }) => next())
      .build();

    const overrideResourceMiddleware = r
      .override(resourceMiddleware)
      .run(async ({ next }) => {
        const result = await next();
        return { [ResultKey.Wrapped]: result };
      })
      .build();

    const resource = r
      .resource(ResourceId.ResourceWithMiddleware)
      .middleware([resourceMiddleware])
      .init(async () => ResourceValue.Base)
      .build();

    const app = r
      .resource(ResourceId.ResourceApp)
      .register([resource, resourceMiddleware])
      .overrides([overrideResourceMiddleware])
      .build();

    const runtime = await run(app);
    expect(runtime.getResourceValue(resource)).toEqual({
      [ResultKey.Wrapped]: ResourceValue.Base,
    });
    await runtime.dispose();
  });

  it(TestName.ResourceMiddlewareDetails, () => {
    const depTask = r
      .task(TaskId.MiddlewareDep)
      .run(async () => TaskValue.Base)
      .build();
    const tagPrimary = r.tag(TagId.Primary).build();
    const tagSecondary = r.tag(TagId.Secondary).build();
    const configSchema = {
      parse: (value: unknown) => value,
    };

    const baseMiddleware = r.middleware
      .resource(MiddlewareId.ResourceDetails)
      .run(async ({ next }) => next())
      .build();

    const overrideMiddleware = r
      .override(baseMiddleware)
      .dependencies({ depTask })
      .dependencies({ depTask }, { override: true })
      .schema(configSchema)
      .configSchema(configSchema)
      .tags([tagPrimary])
      .tags([tagSecondary], { override: true })
      .meta({ [MetaKey.Label]: ResourceValue.Base } as Record<string, any>)
      .everywhere(true)
      .run(async ({ next }) => next())
      .build();

    expect(overrideMiddleware.dependencies).toEqual({ depTask });
    expect(overrideMiddleware.configSchema).toBe(configSchema);
    expect(overrideMiddleware.tags).toEqual([tagSecondary]);
    expect(overrideMiddleware.meta).toEqual({
      [MetaKey.Label]: ResourceValue.Base,
    });
    expect(overrideMiddleware.everywhere).toBe(true);
  });

  it("resource middleware override builder supports throws", () => {
    const errorHelper = r.error(ErrorId.ResourceMiddleware).build();

    const baseMiddleware = r.middleware
      .resource(MiddlewareId.ResourceDetails)
      .run(async ({ next }) => next())
      .build();

    const overrideMiddleware = r
      .override(baseMiddleware)
      .throws([errorHelper])
      .run(async ({ next }) => next())
      .build();

    expect(overrideMiddleware.throws).toEqual([ErrorId.ResourceMiddleware]);
  });

  it(TestName.HookOn, () => {
    const event = r.event(EventId.Base).build();
    const hook = r
      .hook(HookId.Base)
      .on(event)
      .run(async () => undefined)
      .build();

    const overridden = r.override(hook);
    expect("on" in (overridden as unknown as Record<string, unknown>)).toBe(
      false,
    );
  });

  it(TestName.OverrideError, () => {
    const invalid = {};
    expect(() => r.override(invalid as unknown as ITask)).toThrow();
  });
});
