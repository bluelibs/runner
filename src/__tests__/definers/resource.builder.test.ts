import {
  r,
  defineResource,
  definitions,
  run,
  defineTag,
  IResourceMeta,
} from "../..";
import type { AnyError } from "../../types/error";

describe("resource builder", () => {
  it("build() returns branded resource with id", () => {
    const res = r
      .resource("tests-builder-r1")
      .init(async () => Promise.resolve(1))
      .build();
    expect(res.id).toBe("tests-builder-r1");
    // brand
    expect(
      (res as unknown as { [definitions.symbolResource]: boolean })[
        definitions.symbolResource
      ],
    ).toBe(true);
    expect(
      typeof (res as unknown as { [definitions.symbolFilePath]: string })[
        definitions.symbolFilePath
      ],
    ).toBe("string");
  });

  it("register appends by default and overrides when requested", () => {
    const shared = defineResource({
      id: "tests-builder-append-shared",
      init: async () => 1,
    });
    const extra = defineResource({
      id: "tests-builder-append-extra",
      init: async () => 2,
    });
    const append = r
      .resource("tests-builder-append")
      .register(shared)
      .register([extra])
      .build();

    expect(Array.isArray(append.register)).toBe(true);
    if (Array.isArray(append.register)) {
      expect(append.register.map((rSrc) => rSrc.id)).toEqual([
        shared.id,
        extra.id,
      ]);
    }

    const override = r
      .resource("tests-builder-override")
      .register([shared, extra])
      .register(shared, { override: true })
      .build();

    expect(Array.isArray(override.register)).toBe(true);
    if (Array.isArray(override.register)) {
      expect(override.register.map((rSrc) => rSrc.id)).toEqual([shared.id]);
    }
  });

  it("register merges dynamic callbacks into a single function", () => {
    const alpha = defineResource({
      id: "tests-builder-fn-alpha",
      init: async () => 1,
    });
    const beta = defineResource({
      id: "tests-builder-fn-beta",
      init: async () => 2,
    });

    const composed = r
      .resource("tests-builder-registerfn")
      .register(() => [alpha])
      .register(beta)
      .build();

    expect(typeof composed.register).toBe("function");
    if (typeof composed.register === "function") {
      const result = composed.register().map((rSrc) => rSrc.id);
      expect(result).toEqual([alpha.id, beta.id]);
    }
  });

  it("supports config-driven register without init", () => {
    const enabled = defineResource({
      id: "tests-builder-config-only-enabled",
      init: async () => true,
    });

    const configOnly = r
      .resource<{ enabled: boolean }>("tests-builder-config-only")
      .register((config) => (config.enabled ? [enabled] : []))
      .build();

    expect(typeof configOnly.register).toBe("function");
    if (typeof configOnly.register === "function") {
      expect(
        configOnly.register({ enabled: true }).map((item) => item.id),
      ).toEqual([enabled.id]);
      expect(configOnly.register({ enabled: false })).toEqual([]);
    }
  });

  it("register merges array base with lazy callbacks", () => {
    const alpha = defineResource({
      id: "tests-builder-fnfn-alpha",
      init: async () => 1,
    });
    const beta = defineResource({
      id: "tests-builder-fnfn-beta",
      init: async () => 2,
    });

    const composed = r
      .resource("tests-builder-register-array-fn")
      .register([alpha])
      .register(() => [beta])
      .build();

    expect(typeof composed.register).toBe("function");
    if (typeof composed.register === "function") {
      const ids = composed.register().map((rSrc: { id: string }) => rSrc.id);
      expect(ids).toEqual([alpha.id, beta.id]);
    }
  });

  it("chains dependencies, tags, middleware, meta, overrides, register, context", () => {
    const a = defineResource({ id: "tests-a", init: async () => 1 });
    const b = defineResource({ id: "tests-b", init: async () => 2 });
    const app = r
      .resource("tests-builder-app")
      .dependencies({ a, b })
      .register([a, b])
      .tags([])
      .middleware([])
      .context(() => ({ c: 0 }))
      .overrides([])
      .init(async (_cfg, deps, ctx) => {
        ctx.c++;
        return Promise.resolve(deps.a + deps.b + ctx.c);
      })
      .meta({ title: "X" } as unknown as IResourceMeta)
      .ready(async () => {})
      .cooldown(async () => {})
      .health(async () => ({ status: "healthy" }))
      .dispose(async () => {})
      .build();

    expect(
      app.dependencies && typeof app.dependencies === "object",
    ).toBeTruthy();
    expect(app.register).toBeInstanceOf(Array);
    expect(app.context).toBeDefined();
    expect(app.ready).toBeDefined();
    expect(app.cooldown).toBeDefined();
    expect(app.health).toBeDefined();
    expect(app.meta).toEqual({ title: "X" });
  });

  it("resource middleware appends by default and overrides when requested", () => {
    const rmw1 = r.middleware
      .resource("tests-builder-rm-append-1")
      .run(async ({ next }) => next())
      .build();
    const rmw2 = r.middleware
      .resource("tests-builder-rm-append-2")
      .run(async ({ next }) => next())
      .build();

    const appended = r
      .resource("tests-builder-app-mw-append")
      .register([rmw1, rmw2])
      .middleware([rmw1])
      .middleware([rmw2])
      .init(async () => Promise.resolve("OK"))
      .build();

    expect(appended.middleware.map((m) => m.id)).toEqual([rmw1.id, rmw2.id]);

    const overridden = r
      .resource("tests-builder-app-mw-override")
      .register([rmw1, rmw2])
      .middleware([rmw1])
      .middleware([rmw2], { override: true })
      .init(async () => Promise.resolve("OK"))
      .build();

    expect(overridden.middleware.map((m) => m.id)).toEqual([rmw2.id]);
  });

  it("resource overrides append by default and overrides when requested", () => {
    const baseA = defineResource({
      id: "tests-builder-override-a",
      init: async () => 1,
    });
    const baseB = defineResource({
      id: "tests-builder-override-b",
      init: async () => 2,
    });
    const a = r.override(baseA, async () => 11);
    const b = r.override(baseB, async () => 22);

    const appended = r
      .resource("tests-builder-overrides-append")
      .overrides([a])
      .overrides([b])
      .init(async () => Promise.resolve("OK"))
      .build();

    expect(appended.overrides.map((x) => x?.id)).toEqual([a.id, b.id]);

    const overridden = r
      .resource("tests-builder-overrides-override")
      .overrides([a])
      .overrides([b], { override: true })
      .init(async () => Promise.resolve("OK"))
      .build();

    expect(overridden.overrides.map((x) => x?.id)).toEqual([b.id]);
  });

  it("init propagates dependencies and context through the classic signature", async () => {
    const a = defineResource({ id: "tests-a2", init: async () => 5 });
    const app = r
      .resource("tests-builder-app2")
      .register([a])
      .dependencies({ a })
      .context(() => ({ hits: 0 }))
      .init(async (_cfg, deps, ctx) => {
        ctx.hits++;
        return Promise.resolve(deps.a + ctx.hits);
      })
      .build();

    const rr = await run(app);
    const val = rr.getResourceValue(app);
    expect(val).toBe(6);
    await rr.dispose();
  });

  it("infers config type from init signature when unspecified", () => {
    const res = r
      .resource("tests-builder-app-config-infer")
      .init(async (cfg: { flag: boolean }) => {
        return Promise.resolve(cfg.flag ? "Y" : "N");
      })
      .build();

    const configured = res.with({ flag: true });
    expect(configured.config.flag).toBe(true);
  });

  it("supports configSchema, resultSchema and meta", () => {
    const res = r
      .resource("tests-builder-r3")
      .configSchema<{ foo: number }>({
        parse: (x: unknown) => x as { foo: number },
      })
      .resultSchema<number>({ parse: (x: unknown) => x as number })
      .init(async () => Promise.resolve(42))
      .meta({ title: "Configured" } as unknown as IResourceMeta)
      .build();

    expect(res.id).toBe("tests-builder-r3");
    expect(res.meta).toEqual({ title: "Configured" });
  });

  it("supports throws contracts without DI", () => {
    const err = r.error("tests-builder-resource-throws-err").build();
    const otherErr = r.error("tests-builder-resource-throws-other").build();
    const res = r
      .resource("tests-builder-resource-throws")
      .throws([err, otherErr, err])
      .init(async () => Promise.resolve("OK"))
      .build();
    expect(res.throws).toEqual([err.id, otherErr.id]);
  });

  it("isolate is additive across repeated calls", () => {
    const denyTaskA = r
      .task("tests-builder-policy-task-a")
      .run(async () => 1)
      .build();
    const denyTaskB = r
      .task("tests-builder-policy-task-b")
      .run(async () => 2)
      .build();

    const resourceWithPolicy = r
      .resource("tests-builder-policy-resource")
      .isolate({ deny: [denyTaskA] })
      .isolate({ deny: [denyTaskB] })
      .build();

    expect(resourceWithPolicy.isolate).toEqual({
      deny: [denyTaskA, denyTaskB],
    });
  });

  it("isolate preserves and merges only rules across calls", () => {
    const onlyTag = r.tag("tests-builder-policy-only-tag").build();
    const onlyTask = r
      .task("tests-builder-policy-only-task")
      .run(async () => 1)
      .build();

    const resourceWithPolicy = r
      .resource("tests-builder-policy-only-resource")
      .isolate({ only: [onlyTag] })
      .isolate({})
      .isolate({ only: [onlyTask] })
      .isolate({})
      .build();

    expect(resourceWithPolicy.isolate).toEqual({
      only: [onlyTag, onlyTask],
    });
  });

  it("isolate preserves and merges whitelist rules across calls", () => {
    const consumerA = r
      .task("tests-builder-policy-allow-consumer-a")
      .run(async () => 1)
      .build();
    const consumerB = r
      .task("tests-builder-policy-allow-consumer-b")
      .run(async () => 2)
      .build();
    const targetA = r
      .task("tests-builder-policy-allow-target-a")
      .run(async () => 3)
      .build();
    const targetB = r
      .task("tests-builder-policy-allow-target-b")
      .run(async () => 4)
      .build();

    const resourceWithPolicy = r
      .resource("tests-builder-policy-allow-resource")
      .isolate({
        whitelist: [{ for: [consumerA], targets: [targetA] }],
      })
      .isolate({})
      .isolate({
        whitelist: [{ for: [consumerB], targets: [targetB] }],
      })
      .build();

    expect(resourceWithPolicy.isolate).toEqual({
      whitelist: [
        { for: [consumerA], targets: [targetA] },
        { for: [consumerB], targets: [targetB] },
      ],
    });
  });

  it("supports config-driven isolate declarations", () => {
    const publicTask = r
      .task("tests-builder-policy-dynamic-public")
      .run(async () => 1)
      .build();

    const built = r
      .resource<{ visible: boolean }>("tests-builder-policy-dynamic-resource")
      .isolate((config) => ({
        exports: config.visible ? [publicTask] : "none",
      }))
      .init(async () => "ok")
      .build();

    expect(typeof built.isolate).toBe("function");
    if (typeof built.isolate !== "function") {
      return;
    }

    expect(built.isolate({ visible: true })).toEqual({
      exports: [publicTask],
    });
    expect(built.isolate({ visible: false })).toEqual({
      exports: "none",
    });
  });

  it("isolate throws immediately when deny and only would coexist (fail-fast)", () => {
    const onlyTask = r
      .task("tests-builder-policy-conflict-only")
      .run(async () => 1)
      .build();
    const denyTask = r
      .task("tests-builder-policy-conflict-deny")
      .run(async () => 2)
      .build();

    // deny+only in the same .isolate() call
    expect(() => {
      r.resource("tests-builder-policy-conflict-resource").isolate({
        only: [onlyTask],
        deny: [denyTask],
      });
    }).toThrow(
      expect.objectContaining({ id: "runner.errors.isolationConflict" }),
    );

    // deny+only via separate chained calls
    expect(() => {
      r.resource("tests-builder-policy-conflict-chained-resource")
        .isolate({ only: [onlyTask] })
        .isolate({ deny: [denyTask] });
    }).toThrow(
      expect.objectContaining({ id: "runner.errors.isolationConflict" }),
    );
  });

  it("throws on invalid throws entries", () => {
    expect(() =>
      r
        .resource("tests-builder-resource-throws-invalid")
        .throws([{} as AnyError])
        .init(async () => Promise.resolve("OK"))
        .build(),
    ).toThrow(/Invalid throws entry/);
  });

  it("resource middleware built via builder wraps init result", async () => {
    const rmw = r.middleware
      .resource("tests-builder-rm-wrap")
      .run(async ({ next }) => {
        const result = await next();
        return `MW:${String(result)}`;
      })
      .build();

    const app = r
      .resource("tests-builder-app-mw")
      .register([rmw])
      .middleware([rmw])
      .init(async () => Promise.resolve("OK"))
      .build();

    const rr = await run(app);
    expect(String(rr.value)).toBe("MW:OK");
    await rr.dispose();
  });

  it("task middleware built via builder applies when task is called in init", async () => {
    const tmw = r.middleware
      .task("tests-builder-tm-wrap")
      .run(async ({ next }) => {
        const out = await next();
        return `MW:${String(out)}`;
      })
      .build();

    const task = r
      .task("tests-builder-task-mw")
      .middleware([tmw])
      .run(async () => Promise.resolve("ok"))
      .build();

    const app = defineResource({
      id: "tests-builder-app-taskmw",
      register: [tmw, task],
      dependencies: { task },
      async init(_, { task }) {
        return task();
      },
    });

    const rr = await run(app);
    expect(String(rr.value)).toBe("MW:ok");
    await rr.dispose();
  });

  it("resource tags are accessible in middleware during init", async () => {
    const tg = defineTag({ id: "tests-builder-tag" });
    const seen: string[] = [];
    const rmw = r.middleware
      .resource("tests-builder-rm-tags")
      .run(async ({ next, resource }) => {
        if (resource?.definition.tags) {
          for (const t of resource.definition.tags) {
            seen.push(t.id);
          }
        }
        return next();
      })
      .build();

    const app = r
      .resource("tests-builder-app-tags")
      .register([rmw, tg])
      .tags([tg])
      .middleware([rmw])
      .init(async () => Promise.resolve("X"))
      .build();

    const rr = await run(app);
    expect(seen).toContain(tg.id);
    await rr.dispose();
  });

  it("register merges function + function and supports override", () => {
    const gamma = defineResource({
      id: "tests-builder-fnfn-gamma",
      init: async () => 3,
    });
    const delta = defineResource({
      id: "tests-builder-fnfn-delta",
      init: async () => 4,
    });

    const merged = r
      .resource("tests-builder-fnfn")
      .register(() => [gamma])
      .register(() => [delta])
      .build();

    expect(typeof merged.register).toBe("function");
    if (typeof merged.register === "function") {
      const ids = merged.register().map((rSrc) => rSrc.id);
      expect(ids).toEqual([gamma.id, delta.id]);
    }

    const overridden = r
      .resource("tests-builder-fnfn-override")
      .register(() => [gamma])
      .register(() => [delta], { override: true })
      .build();

    expect(typeof overridden.register).toBe("function");
    if (typeof overridden.register === "function") {
      const ids = overridden.register().map((rSrc) => rSrc.id);
      expect(ids).toEqual([delta.id]);
    }
  });

  it("resource dependencies covers function+function and object+function branches", async () => {
    const a = defineResource({
      id: "tests-builder-resdeps-ff-a",
      init: async () => 10,
    });
    const b = defineResource({
      id: "tests-builder-resdeps-ff-b",
      init: async () => 20,
    });

    // function + function
    const res1 = r
      .resource("tests-builder-resdeps-ff")
      .register([a, b])
      .dependencies(() => ({ a }))
      .dependencies(() => ({ b }))
      .init(async (_cfg, deps: { a: number; b: number }) => deps.a + deps.b)
      .build();
    const rr1 = await run(res1);
    expect(rr1.value).toBe(30);
    await rr1.dispose();

    // object + function
    const res2 = r
      .resource("tests-builder-resdeps-of")
      .register([a, b])
      .dependencies({ a })
      .dependencies(() => ({ b }))
      .init(async (_cfg, deps: { a: number; b: number }) => deps.a + deps.b)
      .build();
    const rr2 = await run(res2);
    expect(rr2.value).toBe(30);
    await rr2.dispose();
  });
});
