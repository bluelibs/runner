import { r, run, definitions, resource } from "../..";

describe("task/event/hook/middleware builders", () => {
  it("task builder infers input type from run signature", async () => {
    const task = r
      .task("tests.builder.task.infer")
      .run(async (input: { a: number; b: number }) =>
        Promise.resolve(input.a + input.b),
      )
      .build();

    const app = resource({ id: "tests.app.task.infer", register: [task] });
    const rr = await run(app);
    const out = await rr.runTask(task, { a: 1, b: 2 });
    expect(out).toBe(3);
    await rr.dispose();
  });

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
      .inputSchema<{ a: number; b: number }>({
        parse: (x: unknown) => x as { a: number; b: number },
      })
      .run(
        async (
          input: { a: number; b: number },
          deps: { svc: { add: (a: number, b: number) => number } },
        ) => Promise.resolve(deps.svc.add(input.a, input.b)),
      )
      .build();

    expect(
      (task as unknown as { [definitions.symbolTask]: boolean })[
        definitions.symbolTask
      ],
    ).toBe(true);
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
    await rr.emitEvent(ev, undefined);
    expect(calls).toEqual([ev.id]);
    await rr.dispose();
  });

  it("event dependency supports explicit undefined payload with report mode for void payload events", async () => {
    const ev = r.event("tests.builder.event.dep.report").build();
    const emitFromTask = r
      .task("tests.builder.event.dep.report.emitter")
      .dependencies({ ev })
      .run(async (_input, deps) => {
        const report = await deps.ev(undefined, {
          report: true,
          throwOnError: false,
          failureMode: definitions.EventEmissionFailureMode.Aggregate,
        });
        if (!report) {
          throw new Error("Expected event emission report");
        }
        return report;
      })
      .build();

    const failingHookA = r
      .hook("tests.builder.event.dep.report.hook.a")
      .on(ev)
      .run(async () => {
        throw new Error("hook-a");
      })
      .build();

    const failingHookB = r
      .hook("tests.builder.event.dep.report.hook.b")
      .on(ev)
      .run(async () => {
        throw new Error("hook-b");
      })
      .build();

    const app = resource({
      id: "tests.builder.event.dep.report.app",
      register: [ev, emitFromTask, failingHookA, failingHookB],
    });

    const rr = await run(app);
    const report = await rr.runTask(emitFromTask);
    if (!report) {
      throw new Error("Expected task to return an event emission report");
    }
    expect(report.failedListeners).toBe(2);
    expect(report.errors).toHaveLength(2);
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
    expect(
      (tmw as unknown as { [definitions.symbolTaskMiddleware]: boolean })[
        definitions.symbolTaskMiddleware
      ],
    ).toBe(true);
    expect(
      (rmw as unknown as { [definitions.symbolResourceMiddleware]: boolean })[
        definitions.symbolResourceMiddleware
      ],
    ).toBe(true);
  });

  it("tags append and override on event, hook, and middlewares", () => {
    const tagA = r.tag("tests.builder.tag.A").build();
    const tagB = r.tag("tests.builder.tag.B").build();

    // Event tags append
    const evAppend = r
      .event("tests.builder.event.tags.append")
      .tags([tagA])
      .tags([tagB])
      .build();
    expect(evAppend.tags.map((t) => t.id)).toEqual([tagA.id, tagB.id]);

    // Event tags override
    const evOverride = r
      .event("tests.builder.event.tags.override")
      .tags([tagA])
      .tags([tagB], { override: true })
      .build();
    expect(evOverride.tags.map((t) => t.id)).toEqual([tagB.id]);

    // Event tags explicit false override
    const evFalse = r
      .event("tests.builder.event.tags.false")
      .tags([tagA], { override: false })
      .tags([tagB])
      .build();
    expect(evFalse.tags.map((t) => t.id)).toEqual([tagA.id, tagB.id]);

    // Hook tags append/override
    const ev = r.event("tests.builder.event.forhook.tags").build();
    const hkAppend = r
      .hook("tests.builder.hook.tags.append")
      .on(ev)
      .tags([tagA])
      .tags([tagB])
      .run(async () => {})
      .build();
    expect(hkAppend.tags.map((t) => t.id)).toEqual([tagA.id, tagB.id]);

    const hkOverride = r
      .hook("tests.builder.hook.tags.override")
      .on(ev)
      .tags([tagA])
      .tags([tagB], { override: true })
      .run(async () => {})
      .build();
    expect(hkOverride.tags.map((t) => t.id)).toEqual([tagB.id]);

    const hkFalse = r
      .hook("tests.builder.hook.tags.false")
      .on(ev)
      .tags([tagA], { override: false })
      .tags([tagB])
      .run(async () => {})
      .build();
    expect(hkFalse.tags.map((t) => t.id)).toEqual([tagA.id, tagB.id]);

    // Task middleware tags append/override
    const tmwAppend = r.middleware
      .task("tests.builder.tm.tags.append")
      .tags([tagA])
      .tags([tagB])
      .run(async ({ next, task }) => next(task.input))
      .build();
    expect(tmwAppend.tags.map((t) => t.id)).toEqual([tagA.id, tagB.id]);

    const tmwOverride = r.middleware
      .task("tests.builder.tm.tags.override")
      .tags([tagA])
      .tags([tagB], { override: true })
      .run(async ({ next, task }) => next(task.input))
      .build();
    expect(tmwOverride.tags.map((t) => t.id)).toEqual([tagB.id]);

    const tmwFalse = r.middleware
      .task("tests.builder.tm.tags.false")
      .tags([tagA], { override: false })
      .tags([tagB])
      .run(async ({ next, task }) => next(task.input))
      .build();
    expect(tmwFalse.tags.map((t) => t.id)).toEqual([tagA.id, tagB.id]);

    // Resource middleware tags append/override
    const rmwAppend = r.middleware
      .resource("tests.builder.rm.tags.append")
      .tags([tagA])
      .tags([tagB])
      .run(async ({ next }) => next())
      .build();
    expect(rmwAppend.tags.map((t) => t.id)).toEqual([tagA.id, tagB.id]);

    const rmwOverride = r.middleware
      .resource("tests.builder.rm.tags.override")
      .tags([tagA])
      .tags([tagB], { override: true })
      .run(async ({ next }) => next())
      .build();
    expect(rmwOverride.tags.map((t) => t.id)).toEqual([tagB.id]);

    const rmwFalse = r.middleware
      .resource("tests.builder.rm.tags.false")
      .tags([tagA], { override: false })
      .tags([tagB])
      .run(async ({ next }) => next())
      .build();
    expect(rmwFalse.tags.map((t) => t.id)).toEqual([tagA.id, tagB.id]);
  });

  it("event builder supports payloadSchema, tags and meta", () => {
    const ev = r
      .event("tests.builder.event.meta")
      .payloadSchema<{ foo: number }>({ parse: (x: any) => x })
      .tags([])
      .meta({ title: "E" } as unknown as any)
      .build();
    expect(
      (ev as unknown as { [definitions.symbolEvent]: boolean })[
        definitions.symbolEvent
      ],
    ).toBe(true);
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
      .meta({ title: "H" } as unknown as any)
      .run(async (em) => {
        calls.push(em.id);
      })
      .build();
    const app = resource({
      id: "tests.app.hook.full",
      register: [svc, ev, hk],
    });
    const rr = await run(app);
    await rr.emitEvent(ev, undefined);
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
      .meta({ title: "T" } as unknown as any)
      .run(async (input: number) => Promise.resolve(input + 1))
      .build();
    const app = resource({ id: "tests.app.task.more", register: [task] });
    const rr = await run(app);
    const out = await rr.runTask(task, 1);
    expect(out).toBe(2);
    await rr.dispose();
  });

  it("task builder supports throws contracts without DI", () => {
    const errA = r.error("tests.builder.task.throws.errA").build();
    const errB = r.error("tests.builder.task.throws.errB").build();

    const t = r
      .task("tests.builder.task.throws")
      .throws([errA, errB.id, errA])
      .run(async () => Promise.resolve("ok"))
      .build();

    expect(t.throws).toEqual([errA.id, errB.id]);
  });

  it("task builder throws on invalid throws entries", () => {
    expect(() =>
      r
        .task("tests.builder.task.throws.invalid")
        .throws([{} as unknown as string])
        .run(async () => Promise.resolve("ok"))
        .build(),
    ).toThrow(/Invalid throws entry/);
  });

  it("task dependencies append by default and can override", async () => {
    const a = resource({
      id: "tests.builder.task.deps.a",
      init: async () => 2,
    });
    const b = resource({
      id: "tests.builder.task.deps.b",
      init: async () => 3,
    });

    const t1 = r
      .task("tests.builder.task.deps.append")
      .dependencies(() => ({ a }))
      .dependencies({ b })
      .run(async (_: void, deps: { a: number; b: number }) => deps.a + deps.b)
      .build();

    const app1 = resource({
      id: "tests.app.task.deps.append",
      register: [a, b, t1],
    });
    const rr1 = await run(app1);
    expect(await rr1.runTask(t1)).toBe(5);
    await rr1.dispose();

    const t2 = r
      .task("tests.builder.task.deps.override")
      .dependencies({ a })
      .dependencies({ b }, { override: true })
      .run(async (_: void, deps: { b: number }) => deps.b)
      .build();
    const app2 = resource({
      id: "tests.app.task.deps.override",
      register: [a, b, t2],
    });
    const rr2 = await run(app2);
    expect(await rr2.runTask(t2)).toBe(3);
    await rr2.dispose();
  });

  it("task dependencies function+function merge branch", async () => {
    const a = resource({
      id: "tests.builder.task.deps.ff.a",
      init: async () => 4,
    });
    const b = resource({
      id: "tests.builder.task.deps.ff.b",
      init: async () => 6,
    });

    const t = r
      .task("tests.builder.task.deps.ff")
      .dependencies(() => ({ a }))
      .dependencies(() => ({ b }))
      .run(async (_: void, deps: { a: number; b: number }) => deps.a + deps.b)
      .build();

    const app = resource({ id: "tests.app.task.deps.ff", register: [a, b, t] });
    const rr = await run(app);
    expect(await rr.runTask(t)).toBe(10);
    await rr.dispose();
  });

  it("hook dependencies function+function merge branch", async () => {
    const ev = r.event("tests.builder.hook.deps.ff.ev").build();
    const a = resource({
      id: "tests.builder.hook.deps.ff.a",
      init: async () => 1,
    });
    const b = resource({
      id: "tests.builder.hook.deps.ff.b",
      init: async () => 2,
    });
    const seen: number[] = [];
    const hk = r
      .hook("tests.builder.hook.deps.ff")
      .on(ev)
      .dependencies(() => ({ a }))
      .dependencies(() => ({ b }))
      .run(async (_event, deps: { a: number; b: number }) => {
        seen.push(deps.a + deps.b);
      })
      .build();
    const app = resource({
      id: "tests.app.hook.deps.ff",
      register: [a, b, ev, hk],
    });
    const rr = await run(app);
    await rr.emitEvent(ev, undefined);
    expect(seen).toEqual([3]);
    await rr.dispose();
  });

  it("resource middleware dependencies object+function branch", () => {
    const a = resource({
      id: "tests.builder.rmw.deps.of.a",
      init: async () => 1,
    });
    const b = resource({
      id: "tests.builder.rmw.deps.of.b",
      init: async () => 2,
    });
    const rmw = r.middleware
      .resource("tests.builder.rmw.deps.of")
      .dependencies({ a })
      .dependencies(() => ({ b }))
      .run(async ({ next }) => next())
      .build();
    const depsObj =
      typeof rmw.dependencies === "function"
        ? (rmw.dependencies as unknown as () => any)()
        : rmw.dependencies;
    expect(Object.keys(depsObj)).toEqual(["a", "b"]);
  });

  it("resource middleware dependencies function+object branch", () => {
    const a = resource({
      id: "tests.builder.rmw.deps.fo.a",
      init: async () => 1,
    });
    const b = resource({
      id: "tests.builder.rmw.deps.fo.b",
      init: async () => 2,
    });
    const rmw = r.middleware
      .resource("tests.builder.rmw.deps.fo")
      .dependencies(() => ({ a }))
      .dependencies({ b })
      .run(async ({ next }) => next())
      .build();
    const depsObj =
      typeof rmw.dependencies === "function"
        ? (rmw.dependencies as any)()
        : rmw.dependencies;
    expect(Object.keys(depsObj)).toEqual(["a", "b"]);
  });

  it("hook and middleware dependencies append by default", async () => {
    // Hook dependencies append
    const ev = r.event("tests.builder.deps.event").build();
    const a = resource({
      id: "tests.builder.deps.hook.a",
      init: async () => 1,
    });
    const b = resource({
      id: "tests.builder.deps.hook.b",
      init: async () => 2,
    });
    const calls: number[] = [];
    const hk = r
      .hook("tests.builder.deps.hook")
      .on(ev)
      .dependencies(() => ({ a }))
      .dependencies({ b })
      .run(async (_event, deps: { a: number; b: number }) => {
        calls.push(deps.a + deps.b);
      })
      .build();

    // Task middleware dependencies append (no need to run, just verify merge outcome shape)
    const tmw = r.middleware
      .task("tests.builder.deps.tmw")
      .dependencies(() => ({ a }))
      .dependencies({ b })
      .run(async ({ next, task }, deps: { a: number; b: number }) => {
        // use deps to ensure type coverage
        if (deps.a + deps.b > -1) {
          return next(task.input);
        }
        return next(task.input);
      })
      .build();

    const app = resource({
      id: "tests.builder.deps.app",
      register: [a, b, ev, hk, tmw],
    });
    const rr = await run(app);
    await rr.emitEvent(ev, undefined);
    expect(calls).toEqual([3]);
    await rr.dispose();
  });

  it("hook dependencies override branch", async () => {
    const ev = r.event("tests.builder.deps.ev2").build();
    const a = resource({
      id: "tests.builder.deps.hook2.a",
      init: async () => 1,
    });
    const b = resource({
      id: "tests.builder.deps.hook2.b",
      init: async () => 2,
    });
    const seen: number[] = [];
    const hk = r
      .hook("tests.builder.deps.hook2")
      .on(ev)
      .dependencies({ a })
      .dependencies({ b }, { override: true })
      .run(async (_event, deps: { b: number }) => {
        seen.push(deps.b);
      })
      .build();

    const app = resource({
      id: "tests.builder.deps.app2",
      register: [a, b, ev, hk],
    });
    const rr = await run(app);
    await rr.emitEvent(ev, undefined);
    expect(seen).toEqual([2]);
    await rr.dispose();
  });

  it("task middleware dependencies: function+function merge and override", () => {
    const a = resource({ id: "tests.builder.tmw.deps.a", init: async () => 1 });
    const b = resource({ id: "tests.builder.tmw.deps.b", init: async () => 2 });
    const tmw = r.middleware
      .task("tests.builder.tmw.deps.merge")
      .dependencies(() => ({ a }))
      .dependencies(() => ({ b }))
      .run(async ({ next, task }) => next(task.input))
      .build();

    // dependencies is function; call to get merged object
    const depsObj =
      typeof tmw.dependencies === "function"
        ? (tmw.dependencies as unknown as () => any)()
        : tmw.dependencies;
    expect(Object.keys(depsObj)).toEqual(["a", "b"]);

    const tmw2 = r.middleware
      .task("tests.builder.tmw.deps.override")
      .dependencies({ a })
      .dependencies({ b }, { override: true })
      .run(async ({ next, task }) => next(task.input))
      .build();
    const depsObj2 =
      typeof tmw2.dependencies === "function"
        ? (tmw2.dependencies as unknown as () => any)()
        : tmw2.dependencies;
    expect(Object.keys(depsObj2)).toEqual(["b"]);
  });

  it("resource middleware dependencies: function+function merge and override", () => {
    const a = resource({ id: "tests.builder.rmw.deps.a", init: async () => 1 });
    const b = resource({ id: "tests.builder.rmw.deps.b", init: async () => 2 });
    const rmw = r.middleware
      .resource("tests.builder.rmw.deps.merge")
      .dependencies(() => ({ a }))
      .dependencies(() => ({ b }))
      .run(async ({ next }) => next())
      .build();
    const depsObj =
      typeof rmw.dependencies === "function"
        ? (rmw.dependencies as unknown as () => any)()
        : rmw.dependencies;
    expect(Object.keys(depsObj)).toEqual(["a", "b"]);

    const rmw2 = r.middleware
      .resource("tests.builder.rmw.deps.override")
      .dependencies({ a })
      .dependencies({ b }, { override: true })
      .run(async ({ next }) => next())
      .build();
    const depsObj2 =
      typeof rmw2.dependencies === "function"
        ? (rmw2.dependencies as unknown as () => any)()
        : rmw2.dependencies;
    expect(Object.keys(depsObj2)).toEqual(["b"]);
  });

  it("task middleware appends by default and overrides when requested", async () => {
    const tmw1 = r.middleware
      .task("tests.builder.tm.append.1")
      .run(async ({ next, task }) => next(task.input))
      .build();
    const tmw2 = r.middleware
      .task("tests.builder.tm.append.2")
      .run(async ({ next, task }) => next(task.input))
      .build();

    const t1 = r
      .task("tests.builder.task.mw.append")
      .middleware([tmw1])
      .middleware([tmw2])
      .run(async () => Promise.resolve("ok"))
      .build();

    expect(t1.middleware.map((m) => m.id)).toEqual([tmw1.id, tmw2.id]);

    const t2 = r
      .task("tests.builder.task.mw.override")
      .middleware([tmw1])
      .middleware([tmw2], { override: true })
      .run(async () => Promise.resolve("ok"))
      .build();

    expect(t2.middleware.map((m) => m.id)).toEqual([tmw2.id]);
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
      .run(async (input) => Promise.resolve((input as number) + 3))
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
      .run(async (input, deps) =>
        Promise.resolve(deps.svc.sum(input.a, input.b)),
      )
      .build();

    const app = resource({
      id: "tests.app.task.destructured",
      register: [svc, task],
    });
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
      .meta({ title: "TM" } as unknown as any)
      .everywhere(() => true)
      .run(async ({ next, task }) => next(task.input))
      .build();
    expect(
      (tmw as unknown as { [definitions.symbolTaskMiddleware]: boolean })[
        definitions.symbolTaskMiddleware
      ],
    ).toBe(true);
  });

  it("resource middleware builder supports configSchema, tags, meta, everywhere", () => {
    const rmw = r.middleware
      .resource("tests.builder.rm.full")
      .dependencies({})
      .configSchema<{ timeout: number }>({ parse: (x: any) => x })
      .tags([])
      .meta({ title: "RM" } as unknown as any)
      .everywhere(() => true)
      .run(async ({ next, resource }) => next(resource.config))
      .build();
    expect(
      (rmw as unknown as { [definitions.symbolResourceMiddleware]: boolean })[
        definitions.symbolResourceMiddleware
      ],
    ).toBe(true);
  });

  describe("hook builder validation", () => {
    it("throws when building hook without on()", () => {
      expect(() =>
        r
          .hook("tests.builder.hook.no-on")
          .run(async () => {})
          .build(),
      ).toThrow(/Missing required.*on/);
    });

    it("throws when building hook without run()", () => {
      const ev = r.event("tests.builder.hook.no-run.ev").build();
      expect(() => r.hook("tests.builder.hook.no-run").on(ev).build()).toThrow(
        /Missing required.*run/,
      );
    });

    it("throws when building hook without both on() and run()", () => {
      expect(() => r.hook("tests.builder.hook.no-both").build()).toThrow(
        /Missing required.*on.*run/,
      );
    });

    it("succeeds when both on() and run() are provided", () => {
      const ev = r.event("tests.builder.hook.valid.ev").build();
      const hook = r
        .hook("tests.builder.hook.valid")
        .on(ev)
        .run(async () => {})
        .build();
      expect(hook.id).toBe("tests.builder.hook.valid");
      expect(hook.on).toBe(ev);
    });

    it("allows global listener with on('*')", () => {
      const hook = r
        .hook("tests.builder.hook.global")
        .on("*")
        .run(async () => {})
        .build();
      expect(hook.on).toBe("*");
    });
  });

  describe("middleware builder validation", () => {
    it("throws when building task middleware without run()", () => {
      expect(() =>
        r.middleware.task("tests.builder.tmw.no-run").build(),
      ).toThrow(/Task middleware.*Missing required.*run/);
    });

    it("throws when building resource middleware without run()", () => {
      expect(() =>
        r.middleware.resource("tests.builder.rmw.no-run").build(),
      ).toThrow(/Resource middleware.*Missing required.*run/);
    });

    it("succeeds when task middleware has run()", () => {
      const mw = r.middleware
        .task("tests.builder.tmw.valid")
        .run(async ({ next, task }) => next(task.input))
        .build();
      expect(mw.id).toBe("tests.builder.tmw.valid");
    });

    it("succeeds when resource middleware has run()", () => {
      const mw = r.middleware
        .resource("tests.builder.rmw.valid")
        .run(async ({ next }) => next())
        .build();
      expect(mw.id).toBe("tests.builder.rmw.valid");
    });
  });
});
