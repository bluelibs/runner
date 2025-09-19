import { r, run, definitions, resource } from "../..";

describe("task/event/hook/middleware builders", () => {
  it("task builder produces branded task and run(input, deps) works", async () => {
    const svc = resource({
      id: "tests.svc",
      init: async () => ({
        add: (a: number, b: number) => a + b,
      }),
    });
    const task = r
      .task("tests.builder.task")
      .dependencies({ svc })
      .inputSchema<{ a: number; b: number }>({ parse: (x: any) => x })
      .run(async (
        input: { a: number; b: number },
        deps: { svc: { add: (a: number, b: number) => number } },
      ) => Promise.resolve(deps.svc.add(input.a, input.b)))
      .build();

    expect((task as any)[definitions.symbolTask]).toBe(true);
    const app = resource({ id: "tests.app.task", register: [svc, task] });
    const rr = await run(app);
    const out = await rr.runTask(task, { a: 2, b: 3 });
    expect(out).toBe(5);
    await rr.dispose();
  });

  it("event builder produces branded event and hook builder listens and runs", async () => {
    const ev = r.event("tests.builder.event").build();
    const calls: string[] = [];
    const listener = r
      .hook("tests.builder.hook")
      .on(ev)
      .run(async (em) => {
        calls.push(em.id);
      })
      .build();

    const app = resource({ id: "tests.app.ev", register: [ev, listener] });
    const rr = await run(app);
    await rr.emitEvent(ev, undefined as any);
    expect(calls).toEqual([ev.id]);
    await rr.dispose();
  });

  it("middleware builders produce branded middlewares and can be registered", async () => {
    const tmw = r.middleware
      .task("tests.builder.tm")
      .run(async ({ next, task }) => next(task.input))
      .build();
    const rmw = r.middleware
      .resource("tests.builder.rm")
      .run(async ({ next, resource }) => next(resource.config))
      .build();
    expect((tmw as any)[definitions.symbolTaskMiddleware]).toBe(true);
    expect((rmw as any)[definitions.symbolResourceMiddleware]).toBe(true);
  });

  it("event builder supports payloadSchema, tags and meta", () => {
    const ev = r
      .event("tests.builder.event.meta")
      .payloadSchema<{ foo: number }>({ parse: (x: any) => x })
      .tags([])
      .meta({ title: "E" } as any)
      .build();
    expect((ev as any)[definitions.symbolEvent]).toBe(true);
  });

  it("hook builder supports order, dependencies, tags, meta", async () => {
    const ev = r.event("tests.builder.event.forhook").build();
    const svc = resource({
      id: "tests.hook.svc",
      init: async () => ({ ok: true }),
    });
    const calls: string[] = [];
    const hk = r
      .hook("tests.builder.hook.full")
      .on([ev])
      .order(5)
      .dependencies({ svc })
      .tags([])
      .meta({ title: "H" } as any)
      .run(async (em) => {
        calls.push(em.id);
      })
      .build();
    const app = resource({
      id: "tests.app.hook.full",
      register: [svc, ev, hk],
    });
    const rr = await run(app);
    await rr.emitEvent(ev, undefined as any);
    expect(calls).toEqual([ev.id]);
    await rr.dispose();
  });

  it("task builder supports tags, middleware, resultSchema, meta and direct run", async () => {
    const task = r
      .task("tests.builder.task.more")
      .inputSchema<number>({ parse: (x: any) => x })
      .tags([])
      .middleware([])
      .resultSchema<number>({ parse: (x: any) => x })
      .meta({ title: "T" } as any)
      .run(async (input: number) => Promise.resolve(input + 1))
      .build();
    const app = resource({ id: "tests.app.task.more", register: [task] });
    const rr = await run(app);
    const out = await rr.runTask(task, 1);
    expect(out).toBe(2);
    await rr.dispose();
  });

  it("task builder run handles single param without parentheses (regex miss)", async () => {
    const task = r
      .task("tests.builder.task.noparens")
      .inputSchema<number>({ parse: (x: any) => x })
      // Non-async arrow with single param, no parentheses in toString
      .run((input: number) => Promise.resolve(input + 9))
      .build();
    const app = resource({ id: "tests.app.task.noparens", register: [task] });
    const rr = await run(app);
    const out = await rr.runTask(task, 1);
    expect(out).toBe(10);
    await rr.dispose();
  });

  it("task builder supports traditional 2-arg run signature", async () => {
    const task = r
      .task("tests.builder.task.twoargs")
      .inputSchema<number>({ parse: (x: any) => x })
      .run(async (input: number, _deps: any) => Promise.resolve(input + 2))
      .build();
    const app = resource({ id: "tests.app.task.twoargs", register: [task] });
    const rr = await run(app);
    const out = await rr.runTask(task, 5);
    expect(out).toBe(7);
    await rr.dispose();
  });

  it("task builder runObj delegates to object style", async () => {
    const task = r
      .task("tests.builder.task.runobj")
      .inputSchema<number>({ parse: (x: any) => x })
      .runObj(async ({ input }) => Promise.resolve((input as number) + 3))
      .build();
    const app = resource({ id: "tests.app.task.runobj", register: [task] });
    const rr = await run(app);
    const out = await rr.runTask(task, 4);
    expect(out).toBe(7);
    await rr.dispose();
  });

  it("task builder run auto-detects destructured single-arg and passes { input, deps }", async () => {
    const svc = resource({
      id: "tests.builder.svc.detect",
      init: async () => ({
        sum: (a: number, b: number) => a + b,
      }),
    });
    const task = r
      .task("tests.builder.task.destructured")
      .dependencies({ svc })
      .inputSchema<{ a: number; b: number }>({ parse: (x: any) => x })
      // Use single-parameter destructuring to trigger the looksDestructured branch
      .run(async ({
        input,
        deps,
      }: {
        input: { a: number; b: number };
        deps: { svc: { sum: (a: number, b: number) => number } };
      }) => Promise.resolve(deps.svc.sum(input.a, input.b)))
      .build();

    const app = resource({ id: "tests.app.task.destructured", register: [svc, task] });
    const rr = await run(app);
    const out = await rr.runTask(task, { a: 10, b: 5 });
    expect(out).toBe(15);
    await rr.dispose();
  });

  it("task middleware builder supports configSchema, tags, meta, everywhere", () => {
    const tmw = r.middleware
      .task("tests.builder.tm.full")
      .dependencies({})
      .configSchema<{ retry: number }>({ parse: (x: any) => x })
      .tags([])
      .meta({ title: "TM" } as any)
      .everywhere(() => true)
      .run(async ({ next, task }) => next(task.input))
      .build();
    expect((tmw as any)[definitions.symbolTaskMiddleware]).toBe(true);
  });

  it("resource middleware builder supports configSchema, tags, meta, everywhere", () => {
    const rmw = r.middleware
      .resource("tests.builder.rm.full")
      .dependencies({})
      .configSchema<{ timeout: number }>({ parse: (x: any) => x })
      .tags([])
      .meta({ title: "RM" } as any)
      .everywhere(() => true)
      .run(async ({ next, resource }) => next(resource.config))
      .build();
    expect((rmw as any)[definitions.symbolResourceMiddleware]).toBe(true);
  });
});
