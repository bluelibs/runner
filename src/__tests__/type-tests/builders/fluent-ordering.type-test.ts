import { r, resources } from "../../../";
import { RunnerMode } from "../../../types/runner";

// Type-only tests for strict fluent builder ordering.

{
  // Task: run() locks shape-changing methods, but meta/throws/build remain valid.
  const taskAfterRun = r.task("types-order-task").run(async () => "ok");

  taskAfterRun.meta({ title: "Task" }).throws([]).build();

  r.task("types-order-task-run-after-deps")
    .dependencies({ logger: resources.logger })
    .run(async (_input, deps) => {
      deps.logger.info("task");
      // @ts-expect-error logger contract remains injected
      deps.logger.xx();
      return "ok";
    })
    .build();

  r.task("types-order-task-run-after-schema")
    .schema<{ id: string }>({ parse: (x: any) => x })
    .run(async (input) => input.id)
    .build();

  r.task("types-order-task-run-after-result-schema")
    .resultSchema<{ ok: true }>({ parse: (x: any) => x })
    .run(async () => ({ ok: true as const }))
    .build();

  r.task("types-order-task-run-after-tags")
    .tags([])
    .run(async () => "ok")
    .build();

  r.task("types-order-task-run-after-middleware")
    .middleware([])
    .run(async () => "ok")
    .build();

  r.task("types-order-task-run-after-meta")
    .meta({ title: "Task" })
    .run(async () => "ok")
    .build();

  r.task("types-order-task-run-after-throws")
    .throws([])
    .run(async () => "ok")
    .build();

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
  r.task("types-order-task-meta-before-run").meta({ title: "Task" });

  r.task("x")
    .dependencies({
      logger: resources.logger,
    })
    .run(async (_cfg, deps) => {
      const logger = deps.logger;
      logger.info("Initialized");
      // @ts-expect-error should ensure logger works expected.
      logger.xx();
    });
  // @ts-expect-error build requires run()
  r.task("types-order-task-missing-run").build();
}

{
  // Hook: on() must be declared before run(), and build requires both.
  const event = r.event("types-order-hook-event").build();

  const hookAfterRun = r
    .hook("types-order-hook")
    .on(event)
    .run(async () => {})
    .order(1)
    .meta({ title: "Hook" })
    .throws([]);

  hookAfterRun.build();

  r.hook("types-order-hook-run-after-order")
    .on(event)
    .order(1)
    .run(async () => {})
    .build();

  r.hook("types-order-hook-run-after-deps")
    .on(event)
    .dependencies({ logger: resources.logger })
    .run(async (_emission, deps) => {
      deps.logger.info("hook");
      // @ts-expect-error logger contract remains injected
      deps.logger.xx();
    })
    .build();

  r.hook("types-order-hook-run-after-tags")
    .on(event)
    .tags([])
    .run(async () => {})
    .build();

  r.hook("types-order-hook-run-after-meta")
    .on(event)
    .meta({ title: "Hook" })
    .run(async () => {})
    .build();

  r.hook("types-order-hook-run-after-throws")
    .on(event)
    .throws([])
    .run(async () => {})
    .build();

  // @ts-expect-error run() cannot be called before on()
  r.hook("types-order-hook-run-before-on").run(async () => {});
  const hookMetaBeforeRun = r
    .hook("types-order-hook-meta-before-run")
    .on(event);
  hookMetaBeforeRun.meta({ title: "Hook" });
  const hookDepsLocked = r
    .hook("types-order-hook-locked-deps")
    .on(event)
    .run(async () => {});
  // @ts-expect-error dependencies are locked after run()
  hookDepsLocked.dependencies({});

  const hookTagsLocked = r
    .hook("types-order-hook-locked-tags")
    .on(event)
    .run(async () => {});
  // @ts-expect-error tags are locked after run()
  hookTagsLocked.tags([]);
  // @ts-expect-error build requires run()
  r.hook("types-order-hook-missing-run").on(event).build();
  // @ts-expect-error build requires on()
  r.hook("types-order-hook-missing-on").build();
}

{
  // Task middleware: run() locks config/deps/tags; meta/throws/build remain.
  const taskMwAfterRun = r.middleware
    .task("types-order-task-mw")
    .run(async ({ next, task }) => next(task.input))
    .meta({ title: "TMW" })
    .throws([]);

  taskMwAfterRun.build();

  r.middleware
    .task("types-order-task-mw-run-after-deps")
    .dependencies({ logger: resources.logger })
    .run(async ({ next }, deps) => {
      deps.logger.info("task-mw");
      // @ts-expect-error logger contract remains injected
      deps.logger.xx();
      return next(undefined as never);
    })
    .build();

  r.middleware
    .task("types-order-task-mw-run-after-schema")
    .schema<{ enabled: boolean }>({ parse: (x: any) => x })
    .run(async ({ next }, _deps, config) => {
      const enabled: boolean = config.enabled;
      // @ts-expect-error config contract remains injected
      config.missing;
      return enabled ? next(undefined as never) : next(undefined as never);
    })
    .build();

  r.middleware
    .task("types-order-task-mw-run-after-tags")
    .tags([])
    .run(async ({ next }) => next(undefined as never))
    .build();

  r.middleware
    .task("types-order-task-mw-run-after-meta")
    .meta({ title: "TMW" })
    .run(async ({ next }) => next(undefined as never))
    .build();

  r.middleware
    .task("types-order-task-mw-run-after-throws")
    .throws([])
    .run(async ({ next }) => next(undefined as never))
    .build();

  // @ts-expect-error dependencies are locked after run()
  taskMwAfterRun.dependencies({});
  // @ts-expect-error config schema is locked after run()
  taskMwAfterRun.configSchema({ parse: (x: any) => x });
  // @ts-expect-error tags are locked after run()
  taskMwAfterRun.tags([]);
  r.middleware.task("types-order-task-mw-meta-before-run").meta({
    title: "TMW",
  });
  // @ts-expect-error build requires run()
  r.middleware.task("types-order-task-mw-missing-run").build();
}

{
  // Resource middleware: same locking semantics as task middleware.
  const resourceMwAfterRun = r.middleware
    .resource("types-order-resource-mw")
    .run(async ({ next }) => next())
    .meta({ title: "RMW" })
    .throws([]);

  resourceMwAfterRun.build();

  r.middleware
    .resource("types-order-resource-mw-run-after-deps")
    .dependencies({ logger: resources.logger })
    .run(async ({ next }, deps) => {
      deps.logger.info("resource-mw");
      // @ts-expect-error logger contract remains injected
      deps.logger.xx();
      return next();
    })
    .build();

  r.middleware
    .resource("types-order-resource-mw-run-after-schema")
    .schema<{ enabled: boolean }>({ parse: (x: any) => x })
    .run(async ({ next }, _deps, config) => {
      const enabled: boolean = config.enabled;
      return enabled ? next() : next();
    })
    .build();

  r.middleware
    .resource("types-order-resource-mw-run-after-tags")
    .tags([])
    .run(async ({ next }) => next())
    .build();

  r.middleware
    .resource("types-order-resource-mw-run-after-meta")
    .meta({ title: "RMW" })
    .run(async ({ next }) => next())
    .build();

  r.middleware
    .resource("types-order-resource-mw-run-after-throws")
    .throws([])
    .run(async ({ next }) => next())
    .build();

  // @ts-expect-error dependencies are locked after run()
  resourceMwAfterRun.dependencies({});
  // @ts-expect-error config schema is locked after run()
  resourceMwAfterRun.configSchema({ parse: (x: any) => x });
  // @ts-expect-error tags are locked after run()
  resourceMwAfterRun.tags([]);
  r.middleware.resource("types-order-resource-mw-meta-before-run").meta({
    title: "RMW",
  });
  // @ts-expect-error build requires run()
  r.middleware.resource("types-order-resource-mw-missing-run").build();
}

{
  // Resource: init() locks shape/wiring-affecting methods; post-init metadata and topology methods stay valid.
  const child = r.resource("types-order-resource-child").build();
  const dep = r
    .resource("types-order-resource-cooldown-dep")
    .init(async () => 1)
    .build();

  const resourceAfterInit = r
    .resource("types-order-resource")
    .dependencies({ dep })
    .schema<{ enabled: boolean }>({ parse: (x: any) => x })
    .resultSchema<{ ready: true }>({ parse: (x: any) => x })
    .tags([])
    .middleware([])
    .context(() => ({ started: false }))
    .init(async (cfg, deps, ctx) => {
      const cfgValue: { enabled: boolean } = cfg;
      const depValue: number = deps.dep;
      const ctxValue: { started: boolean } = ctx;
      return Promise.resolve({
        ready: cfgValue.enabled && depValue > 0 && ctxValue.started === false,
      });
    })
    .register([child])
    .overrides([])
    .isolate({})
    .isolate({ exports: [] })
    .ready(async (value, config, deps, context) => {
      const valueReady: boolean = value.ready;
      const configEnabled: boolean = config.enabled;
      const depValue: number = deps.dep;
      const contextStarted: boolean = context.started;
      [valueReady, configEnabled, depValue, contextStarted];
    })
    .cooldown(async (value, config, deps, context) => {
      const valueReady: boolean = value.ready;
      const configEnabled: boolean = config.enabled;
      const depValue: number = deps.dep;
      const contextStarted: boolean = context.started;
      [valueReady, configEnabled, depValue, contextStarted];
    })
    .dispose(async (value, config, deps, context) => {
      const valueReady: boolean = value.ready;
      const configEnabled: boolean = config.enabled;
      const depValue: number = deps.dep;
      const contextStarted: boolean = context.started;
      [valueReady, configEnabled, depValue, contextStarted];
    })
    .meta({ title: "Resource" })
    .throws([]);

  resourceAfterInit.build();

  r.resource<{ strict: boolean }>("types-order-resource-dynamic-isolate")
    .isolate((config, mode) => {
      const runtimeMode: RunnerMode | undefined = mode;
      void runtimeMode;
      return {
        exports: config.strict ? "none" : [],
      };
    })
    .init(async () => "ok")
    .build();

  const resourceDepsLocked = r
    .resource("types-order-resource-locked-deps")
    .init(async () => "ok");
  // @ts-expect-error dependencies are locked after init()
  resourceDepsLocked.dependencies({});

  const resourceSchemaLocked = r
    .resource("types-order-resource-locked-schema")
    .init(async () => "ok");
  // @ts-expect-error schema is locked after init()
  resourceSchemaLocked.schema({ parse: (x: any) => x });

  const resourceResultSchemaLocked = r
    .resource("types-order-resource-locked-result-schema")
    .init(async () => "ok");
  // @ts-expect-error resultSchema is locked after init()
  resourceResultSchemaLocked.resultSchema({ parse: (x: any) => x });

  const resourceTagsLocked = r
    .resource("types-order-resource-locked-tags")
    .init(async () => "ok");
  // @ts-expect-error tags are locked after init()
  resourceTagsLocked.tags([]);

  const resourceMiddlewareLocked = r
    .resource("types-order-resource-locked-middleware")
    .init(async () => "ok");
  // @ts-expect-error middleware is locked after init()
  resourceMiddlewareLocked.middleware([]);

  const resourceContextLocked = r
    .resource("types-order-resource-locked-context")
    .init(async () => "ok");
  // @ts-expect-error context is locked after init()
  resourceContextLocked.context(() => ({}));

  r.resource("types-order-resource-init-bare")
    .init(async () => "ok")
    .build();

  r.resource("types-order-resource-init-after-deps")
    .dependencies({ dep })
    .init(async (_config, deps) => deps.dep)
    .build();

  r.resource<{ mode: "dev" | "prod" }>(
    "types-order-resource-init-generic-config",
  )
    .init(async (config) => {
      const mode: "dev" | "prod" = config.mode;
      void mode;
      // @ts-expect-error generic config should be preserved
      config.missing;
      return "ok";
    })
    .build();

  r.resource("types-order-resource-init-after-schema")
    .schema<{ enabled: boolean }>({ parse: (x: any) => x })
    .init(async (config) => {
      const enabled: boolean = config.enabled;
      // @ts-expect-error schema-inferred config should be preserved
      config.missing;
      return enabled;
    })
    .build();

  r.resource("types-order-resource-init-after-result-schema")
    .resultSchema<{ ready: true }>({ parse: (x: any) => x })
    .init(async () => ({ ready: true as const }))
    .build();

  r.resource("types-order-resource-init-after-middleware")
    .middleware([])
    .init(async () => "ok")
    .build();

  r.resource("types-order-resource-init-after-context")
    .context(() => ({ started: true }))
    .init(async (_config, _deps, ctx) => ctx.started)
    .build();

  r.resource("types-order-resource-init-after-meta-and-schema")
    .meta({ title: "Resource" })
    .schema<{ retries: number }>({ parse: (x: any) => x })
    .init(async (config) => {
      const retries: number = config.retries;
      // @ts-expect-error config inference should survive pre-init metadata
      config.enabled;
      return retries;
    })
    .build();

  r.resource("types-order-resource-init-after-meta")
    .meta({ title: "Resource" })
    .init(async () => "ok")
    .build();

  r.resource("types-order-resource-init-after-throws")
    .throws([])
    .init(async () => "ok")
    .build();

  r.resource("types-order-resource-init-after-register")
    .register([child])
    .init(async () => "ok")
    .build();

  r.resource("types-order-resource-init-after-deps-and-schema")
    .dependencies({ logger: resources.logger })
    .schema<{ level: "info" | "warn" }>({ parse: (x: any) => x })
    .init(async (config, deps) => {
      const level: "info" | "warn" = config.level;
      deps.logger.info(level);
      // @ts-expect-error config inference should survive dependency wiring
      config.missing;
      // @ts-expect-error dependency injection should still be typed
      deps.logger.xx();
      return { level };
    })
    .build();

  r.resource("types-order-resource-init-after-isolate")
    .isolate({})
    .init(async () => "ok")
    .build();

  r.resource("types-order-resource-init-after-subtree")
    .subtree({})
    .init(async () => "ok")
    .build();

  r.resource("types-order-resource-init-after-overrides")
    .overrides([])
    .init(async () => "ok")
    .build();

  r.resource("x")
    .dependencies({
      logger: resources.logger,
    })
    .health(async (_value, _cfg, deps) => {
      const logger = deps.logger;
      logger.info("Health check");
      // @ts-expect-error should ensure logger works expected.
      logger.xx();
      return { status: "healthy" as const };
    })
    .init(async (_cfg, deps) => {
      const logger = deps.logger;
      logger.info("Initialized");
      // @ts-expect-error should ensure logger works expected.
      logger.xx();

      return {};
    });

  r.resource("types-order-resource-meta-before-init").meta({
    title: "Resource",
  });

  // init remains optional on resources
  r.resource("types-order-resource-no-init").build();
}
