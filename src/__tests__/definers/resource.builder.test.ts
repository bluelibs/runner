import { r, resource, definitions, run, tag } from "../..";

describe("resource builder", () => {
  it("build() returns branded resource with id", () => {
    const res = r
      .resource("tests.builder.r1")
      .init(async () => Promise.resolve(1))
      .build();
    expect(res.id).toBe("tests.builder.r1");
    // brand
    expect((res as any)[definitions.symbolResource]).toBe(true);
    expect(typeof (res as any)[definitions.symbolFilePath]).toBe("string");
  });

  it("register appends by default and overrides when requested", () => {
    const shared = resource({
      id: "tests.builder.append.shared",
      init: async () => 1,
    });
    const extra = resource({
      id: "tests.builder.append.extra",
      init: async () => 2,
    });
    const append = r
      .resource("tests.builder.append")
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
      .resource("tests.builder.override")
      .register([shared, extra])
      .register(shared, { override: true })
      .build();

    expect(Array.isArray(override.register)).toBe(true);
    if (Array.isArray(override.register)) {
      expect(override.register.map((rSrc) => rSrc.id)).toEqual([shared.id]);
    }
  });

  it("register merges dynamic callbacks into a single function", () => {
    const alpha = resource({
      id: "tests.builder.fn.alpha",
      init: async () => 1,
    });
    const beta = resource({ id: "tests.builder.fn.beta", init: async () => 2 });

    const composed = r
      .resource("tests.builder.registerfn")
      .register(() => [alpha])
      .register(beta)
      .build();

    expect(typeof composed.register).toBe("function");
    if (typeof composed.register === "function") {
      const result = composed.register().map((rSrc) => rSrc.id);
      expect(result).toEqual([alpha.id, beta.id]);
    }
  });

  it("register merges array base with lazy callbacks", () => {
    const alpha = resource({ id: "tests.builder.fnfn.alpha", init: async () => 1 });
    const beta = resource({ id: "tests.builder.fnfn.beta", init: async () => 2 });

    const composed = r
      .resource("tests.builder.register.array-fn")
      .register([alpha])
      .register(() => [beta])
      .build();

    expect(typeof composed.register).toBe("function");
    if (typeof composed.register === "function") {
      const ids = composed.register({} as any).map((rSrc) => rSrc.id);
      expect(ids).toEqual([alpha.id, beta.id]);
    }
  });

  it("chains dependencies, tags, middleware, meta, overrides, register, context", () => {
    const a = resource({ id: "tests.a", init: async () => 1 });
    const b = resource({ id: "tests.b", init: async () => 2 });
    const app = r
      .resource("tests.builder.app")
      .dependencies({ a, b })
      .register([a, b])
      .tags([])
      .middleware([])
      .context(() => ({ c: 0 }))
      .meta({ title: "X" } as any)
      .overrides([])
      .init(async (_cfg, deps, ctx) => {
        ctx.c++;
        return Promise.resolve(deps.a + deps.b + ctx.c);
      })
      .dispose(async () => {})
      .build();

    expect(
      app.dependencies && typeof app.dependencies === "object",
    ).toBeTruthy();
    expect(app.register).toBeInstanceOf(Array);
    expect(app.context).toBeDefined();
    expect(app.meta).toEqual({ title: "X" });
  });

  it("init propagates dependencies and context through the classic signature", async () => {
    const a = resource({ id: "tests.a2", init: async () => 5 });
    const app = r
      .resource("tests.builder.app2")
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
      .resource("tests.builder.app.config-infer")
      .init(async (cfg: { flag: boolean }) => {
        return Promise.resolve(cfg.flag ? "Y" : "N");
      })
      .build();

    const configured = res.with({ flag: true });
    expect(configured.config.flag).toBe(true);
  });

  it("supports configSchema, resultSchema and meta", () => {
    const res = r
      .resource("tests.builder.r3")
      .configSchema<{ foo: number }>({ parse: (x: any) => x })
      .resultSchema<number>({ parse: (x: any) => x })
      .meta({ title: "Configured" } as any)
      .init(async () => Promise.resolve(42))
      .build();

    expect(res.id).toBe("tests.builder.r3");
    expect(res.meta).toEqual({ title: "Configured" });
  });

  it("resource middleware built via builder wraps init result", async () => {
    const rmw = r.middleware
      .resource("tests.builder.rm.wrap")
      .run(async ({ next }) => {
        const result = await next();
        return `MW:${String(result)}`;
      })
      .build();

    const app = r
      .resource("tests.builder.app.mw")
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
      .task("tests.builder.tm.wrap")
      .run(async ({ next }) => {
        const out = await next();
        return `MW:${String(out)}`;
      })
      .build();

    const task = r
      .task("tests.builder.task.mw")
      .middleware([tmw])
      .run(async () => Promise.resolve("ok"))
      .build();

    const app = resource({
      id: "tests.builder.app.taskmw",
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
    const tg = tag({ id: "tests.builder.tag" });
    const seen: string[] = [];
    const rmw = r.middleware
      .resource("tests.builder.rm.tags")
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
      .resource("tests.builder.app.tags")
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
    const gamma = resource({
      id: "tests.builder.fnfn.gamma",
      init: async () => 3,
    });
    const delta = resource({
      id: "tests.builder.fnfn.delta",
      init: async () => 4,
    });

    const merged = r
      .resource("tests.builder.fnfn")
      .register(() => [gamma])
      .register(() => [delta])
      .build();

    expect(typeof merged.register).toBe("function");
    if (typeof merged.register === "function") {
      const ids = merged.register().map((rSrc) => rSrc.id);
      expect(ids).toEqual([gamma.id, delta.id]);
    }

    const overridden = r
      .resource("tests.builder.fnfn.override")
      .register(() => [gamma])
      .register(() => [delta], { override: true })
      .build();

    expect(typeof overridden.register).toBe("function");
    if (typeof overridden.register === "function") {
      const ids = overridden.register().map((rSrc) => rSrc.id);
      expect(ids).toEqual([delta.id]);
    }
  });
});
