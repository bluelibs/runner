import { r, resource, definitions, run } from "../..";

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

  it("initObj sugar supports destructuring", async () => {
    const a = resource({ id: "tests.a2", init: async () => 5 });
    const app = r
      .resource("tests.builder.app2")
      .register([a])
      .dependencies({ a })
      .context(() => ({ hits: 0 }))
      .initObj(async ({ deps, ctx }) => {
        ctx.hits++;
        return Promise.resolve(deps.a + ctx.hits);
      })
      .build();

    const rr = await run(app);
    const val = rr.getResourceValue(app);
    expect(val).toBe(6);
    await rr.dispose();
  });

  it("supports configSchema, resultSchema and lock mutator", () => {
    const res = r
      .resource("tests.builder.r3")
      .configSchema<{ foo: number }>({ parse: (x: any) => x })
      .resultSchema<number>({ parse: (x: any) => x })
      .init(async () => Promise.resolve(42))
      .lock((def) => {
        def.meta = { title: "Locked" } as any;
      });

    expect(res.id).toBe("tests.builder.r3");
    expect(res.meta).toEqual({ title: "Locked" });
  });

  it("lock without mutator returns resource as-built", () => {
    const res = r
      .resource("tests.builder.r4")
      .init(async () => Promise.resolve(1))
      .lock();
    expect(res.id).toBe("tests.builder.r4");
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
    const tg = (await import("../..")).tag({ id: "tests.builder.tag" });
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
});
