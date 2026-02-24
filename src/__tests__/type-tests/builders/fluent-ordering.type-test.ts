import { r } from "../../../";

// Type-only tests for strict fluent builder ordering.

{
  // Task: run() locks shape-changing methods, but meta/throws/build remain valid.
  const taskAfterRun = r.task("types.order.task").run(async () => "ok");

  taskAfterRun.meta({ title: "Task" }).throws([]).build();

  // @ts-expect-error dependencies are locked after run()
  taskAfterRun.dependencies({});
  // @ts-expect-error schema is locked after run()
  taskAfterRun.schema({ parse: (x: any) => x });
  // @ts-expect-error resultSchema is locked after run()
  taskAfterRun.resultSchema({ parse: (x: any) => x });
  // @ts-expect-error tags are locked after run()
  taskAfterRun.tags([]);
  // @ts-expect-error middleware is locked after run()
  taskAfterRun.middleware([]);
  r.task("types.order.task.meta-before-run").meta({ title: "Task" });

  // @ts-expect-error build requires run()
  r.task("types.order.task.missing-run").build();
}

{
  // Hook: on() must be declared before run(), and build requires both.
  const event = r.event("types.order.hook.event").build();

  const hookAfterRun = r
    .hook("types.order.hook")
    .on(event)
    .run(async () => {})
    .order(1)
    .meta({ title: "Hook" })
    .throws([]);

  hookAfterRun.build();

  // @ts-expect-error run() cannot be called before on()
  r.hook("types.order.hook.run-before-on").run(async () => {});
  const hookMetaBeforeRun = r
    .hook("types.order.hook.meta-before-run")
    .on(event);
  hookMetaBeforeRun.meta({ title: "Hook" });
  const hookDepsLocked = r
    .hook("types.order.hook.locked.deps")
    .on(event)
    .run(async () => {});
  // @ts-expect-error dependencies are locked after run()
  hookDepsLocked.dependencies({});

  const hookTagsLocked = r
    .hook("types.order.hook.locked.tags")
    .on(event)
    .run(async () => {});
  // @ts-expect-error tags are locked after run()
  hookTagsLocked.tags([]);
  // @ts-expect-error build requires run()
  r.hook("types.order.hook.missing-run").on(event).build();
  // @ts-expect-error build requires on()
  r.hook("types.order.hook.missing-on").build();
}

{
  // Task middleware: run() locks config/deps/tags; meta/throws/build remain.
  const taskMwAfterRun = r.middleware
    .task("types.order.task-mw")
    .run(async ({ next, task }) => next(task.input))
    .meta({ title: "TMW" })
    .throws([]);

  taskMwAfterRun.build();

  // @ts-expect-error dependencies are locked after run()
  taskMwAfterRun.dependencies({});
  // @ts-expect-error config schema is locked after run()
  taskMwAfterRun.configSchema({ parse: (x: any) => x });
  // @ts-expect-error tags are locked after run()
  taskMwAfterRun.tags([]);
  r.middleware.task("types.order.task-mw.meta-before-run").meta({
    title: "TMW",
  });
  // @ts-expect-error build requires run()
  r.middleware.task("types.order.task-mw.missing-run").build();
}

{
  // Resource middleware: same locking semantics as task middleware.
  const resourceMwAfterRun = r.middleware
    .resource("types.order.resource-mw")
    .run(async ({ next }) => next())
    .meta({ title: "RMW" })
    .throws([]);

  resourceMwAfterRun.build();

  // @ts-expect-error dependencies are locked after run()
  resourceMwAfterRun.dependencies({});
  // @ts-expect-error config schema is locked after run()
  resourceMwAfterRun.configSchema({ parse: (x: any) => x });
  // @ts-expect-error tags are locked after run()
  resourceMwAfterRun.tags([]);
  r.middleware.resource("types.order.resource-mw.meta-before-run").meta({
    title: "RMW",
  });
  // @ts-expect-error build requires run()
  r.middleware.resource("types.order.resource-mw.missing-run").build();
}

{
  // Resource: init() locks shape/wiring-affecting methods; post-init metadata and topology methods stay valid.
  const child = r.resource("types.order.resource.child").build();

  const resourceAfterInit = r
    .resource("types.order.resource")
    .dependencies({})
    .schema<{ enabled: boolean }>({ parse: (x: any) => x })
    .resultSchema<{ ready: true }>({ parse: (x: any) => x })
    .tags([])
    .middleware([])
    .context(() => ({ started: false }))
    .init(async () => ({ ready: true as const }))
    .register([child])
    .overrides([])
    .isolate({})
    .exports([])
    .dispose(async () => {})
    .meta({ title: "Resource" })
    .throws([]);

  resourceAfterInit.build();

  const resourceDepsLocked = r
    .resource("types.order.resource.locked.deps")
    .init(async () => "ok");
  // @ts-expect-error dependencies are locked after init()
  resourceDepsLocked.dependencies({});

  const resourceSchemaLocked = r
    .resource("types.order.resource.locked.schema")
    .init(async () => "ok");
  // @ts-expect-error schema is locked after init()
  resourceSchemaLocked.schema({ parse: (x: any) => x });

  const resourceResultSchemaLocked = r
    .resource("types.order.resource.locked.result-schema")
    .init(async () => "ok");
  // @ts-expect-error resultSchema is locked after init()
  resourceResultSchemaLocked.resultSchema({ parse: (x: any) => x });

  const resourceTagsLocked = r
    .resource("types.order.resource.locked.tags")
    .init(async () => "ok");
  // @ts-expect-error tags are locked after init()
  resourceTagsLocked.tags([]);

  const resourceMiddlewareLocked = r
    .resource("types.order.resource.locked.middleware")
    .init(async () => "ok");
  // @ts-expect-error middleware is locked after init()
  resourceMiddlewareLocked.middleware([]);

  const resourceContextLocked = r
    .resource("types.order.resource.locked.context")
    .init(async () => "ok");
  // @ts-expect-error context is locked after init()
  resourceContextLocked.context(() => ({}));
  r.resource("types.order.resource.meta-before-init").meta({
    title: "Resource",
  });

  // init remains optional on resources
  r.resource("types.order.resource.no-init").build();
}
