import { r, run } from "../..";
import { Store } from "../../models/Store";

/**
 * Tests for getAllThrows() — aggregates declared error ids from a task or
 * resource across its full dependency chain.
 */
describe("getAllThrows()", () => {
  // ── Helpers ────────────────────────────────────────────────────────────

  const errA = r.error("tests.getAllThrows.errA").build();
  const errB = r.error("tests.getAllThrows.errB").build();
  const errC = r.error("tests.getAllThrows.errC").build();
  const errD = r.error("tests.getAllThrows.errD").build();
  const errE = r.error("tests.getAllThrows.errE").build();
  const errF = r.error("tests.getAllThrows.errF").build();

  /** Scaffolds a Store whose registry has been populated via run(). */
  async function withRuntime(
    app: ReturnType<typeof r.resource.prototype.build>,
    fn: (store: Store) => void,
  ) {
    const runtime = await run(app);
    // The store is accessible via the internal runtime result
    const store = (runtime as unknown as { store: Store }).store;
    fn(store);
    await runtime.dispose();
  }

  // ── Task: own throws ──────────────────────────────────────────────────

  it("collects a task's own throws", async () => {
    const task = r
      .task("tests.getAllThrows.taskOwn")
      .throws([errA, errB])
      .run(async () => "ok")
      .build();

    const app = r
      .resource("tests.getAllThrows.taskOwn.app")
      .register([task])
      .build();

    await withRuntime(app, (store) => {
      const result = store.getAllThrows(task);
      expect(result).toEqual([errA.id, errB.id]);
    });
  });

  // ── Task: middleware throws ───────────────────────────────────────────

  it("collects throws from task middleware (local)", async () => {
    const mw = r.middleware
      .task("tests.getAllThrows.tmwLocal")
      .throws([errC])
      .run(async ({ next, task }) => next(task.input))
      .build();

    const task = r
      .task("tests.getAllThrows.taskMwLocal")
      .throws([errA])
      .middleware([mw])
      .run(async () => "ok")
      .build();

    const app = r
      .resource("tests.getAllThrows.taskMwLocal.app")
      .register([task, mw])
      .build();

    await withRuntime(app, (store) => {
      const result = store.getAllThrows(task);
      expect(result).toContain(errA.id);
      expect(result).toContain(errC.id);
    });
  });

  it("collects throws from everywhere task middleware", async () => {
    const globalMw = r.middleware
      .task("tests.getAllThrows.tmwEverywhere")
      .throws([errD])
      .everywhere(true)
      .run(async ({ next, task }) => next(task.input))
      .build();

    const task = r
      .task("tests.getAllThrows.taskMwEverywhere")
      .throws([errA])
      .run(async () => "ok")
      .build();

    const app = r
      .resource("tests.getAllThrows.taskMwEverywhere.app")
      .register([task, globalMw])
      .build();

    await withRuntime(app, (store) => {
      const result = store.getAllThrows(task);
      expect(result).toContain(errA.id);
      expect(result).toContain(errD.id);
    });
  });

  // ── Task: resource dependency throws ──────────────────────────────────

  it("collects throws from resource dependencies", async () => {
    const dep = r
      .resource("tests.getAllThrows.resDep")
      .throws([errB])
      .init(async () => 42)
      .build();

    const task = r
      .task("tests.getAllThrows.taskResDep")
      .throws([errA])
      .dependencies({ dep })
      .run(async () => "ok")
      .build();

    const app = r
      .resource("tests.getAllThrows.taskResDep.app")
      .register([dep, task])
      .build();

    await withRuntime(app, (store) => {
      const result = store.getAllThrows(task);
      expect(result).toContain(errA.id);
      expect(result).toContain(errB.id);
    });
  });

  // ── Task: hook throws for emitted events ──────────────────────────────

  it("collects throws from hooks listening to events the task can emit", async () => {
    const event = r.event("tests.getAllThrows.ev").build();

    const hook = r
      .hook("tests.getAllThrows.hookOnEv")
      .on(event)
      .throws([errE])
      .run(async () => {})
      .build();

    const task = r
      .task("tests.getAllThrows.taskEmit")
      .throws([errA])
      .dependencies({ event })
      .run(async () => "ok")
      .build();

    const app = r
      .resource("tests.getAllThrows.taskEmit.app")
      .register([event, hook, task])
      .build();

    await withRuntime(app, (store) => {
      const result = store.getAllThrows(task);
      expect(result).toContain(errA.id);
      expect(result).toContain(errE.id);
    });
  });

  it("collects throws from wildcard hooks", async () => {
    const event = r.event("tests.getAllThrows.evWild").build();

    const wildcardHook = r
      .hook("tests.getAllThrows.hookWild")
      .on("*")
      .throws([errF])
      .run(async () => {})
      .build();

    const task = r
      .task("tests.getAllThrows.taskWild")
      .dependencies({ event })
      .run(async () => "ok")
      .build();

    const app = r
      .resource("tests.getAllThrows.taskWild.app")
      .register([event, wildcardHook, task])
      .build();

    await withRuntime(app, (store) => {
      const result = store.getAllThrows(task);
      expect(result).toContain(errF.id);
    });
  });

  // ── Resource: own throws + middleware ──────────────────────────────────

  it("collects a resource's own throws", async () => {
    const res = r
      .resource("tests.getAllThrows.resOwn")
      .throws([errA, errB])
      .init(async () => 1)
      .build();

    const app = r
      .resource("tests.getAllThrows.resOwn.app")
      .register([res])
      .build();

    await withRuntime(app, (store) => {
      const result = store.getAllThrows(res);
      expect(result).toEqual([errA.id, errB.id]);
    });
  });

  it("collects throws from resource middleware (local)", async () => {
    const rmw = r.middleware
      .resource("tests.getAllThrows.rmwLocal")
      .throws([errC])
      .run(async ({ next }) => next())
      .build();

    const res = r
      .resource("tests.getAllThrows.resMwLocal")
      .throws([errA])
      .middleware([rmw])
      .init(async () => 1)
      .build();

    const app = r
      .resource("tests.getAllThrows.resMwLocal.app")
      .register([res, rmw])
      .build();

    await withRuntime(app, (store) => {
      const result = store.getAllThrows(res);
      expect(result).toContain(errA.id);
      expect(result).toContain(errC.id);
    });
  });

  it("collects throws from everywhere resource middleware", async () => {
    const globalRmw = r.middleware
      .resource("tests.getAllThrows.rmwEverywhere")
      .throws([errD])
      .everywhere(true)
      .run(async ({ next }) => next())
      .build();

    const res = r
      .resource("tests.getAllThrows.resMwEverywhere")
      .throws([errA])
      .init(async () => 1)
      .build();

    const app = r
      .resource("tests.getAllThrows.resMwEverywhere.app")
      .register([res, globalRmw])
      .build();

    await withRuntime(app, (store) => {
      const result = store.getAllThrows(res);
      expect(result).toContain(errA.id);
      expect(result).toContain(errD.id);
    });
  });

  // ── Deduplication ─────────────────────────────────────────────────────

  it("deduplicates error ids across sources", async () => {
    const mw = r.middleware
      .task("tests.getAllThrows.dedupMw")
      .throws([errA, errB])
      .run(async ({ next, task }) => next(task.input))
      .build();

    const task = r
      .task("tests.getAllThrows.dedup")
      .throws([errA, errC])
      .middleware([mw])
      .run(async () => "ok")
      .build();

    const app = r
      .resource("tests.getAllThrows.dedup.app")
      .register([task, mw])
      .build();

    await withRuntime(app, (store) => {
      const result = store.getAllThrows(task);
      // errA appears from task AND middleware, but only once in result
      expect(result).toEqual([errA.id, errC.id, errB.id]);
    });
  });

  // ── Empty / no throws ─────────────────────────────────────────────────

  it("returns empty array when nothing declares throws", async () => {
    const task = r
      .task("tests.getAllThrows.empty")
      .run(async () => "ok")
      .build();

    const app = r
      .resource("tests.getAllThrows.empty.app")
      .register([task])
      .build();

    await withRuntime(app, (store) => {
      const result = store.getAllThrows(task);
      expect(result).toEqual([]);
    });
  });

  // ── Resource dependency with resource middleware throws ────────────────

  it("collects throws from resource dep's middleware", async () => {
    const rmw = r.middleware
      .resource("tests.getAllThrows.depRmw")
      .throws([errE])
      .run(async ({ next }) => next())
      .build();

    const dep = r
      .resource("tests.getAllThrows.depWithRmw")
      .throws([errB])
      .middleware([rmw])
      .init(async () => 42)
      .build();

    const task = r
      .task("tests.getAllThrows.taskDepRmw")
      .throws([errA])
      .dependencies({ dep })
      .run(async () => "ok")
      .build();

    const app = r
      .resource("tests.getAllThrows.taskDepRmw.app")
      .register([rmw, dep, task])
      .build();

    await withRuntime(app, (store) => {
      const result = store.getAllThrows(task);
      expect(result).toContain(errA.id);
      expect(result).toContain(errB.id);
      expect(result).toContain(errE.id);
    });
  });

  // ── Everywhere middleware as function ──────────────────────────────────

  it("collects throws from everywhere task middleware (function form)", async () => {
    const funcMw = r.middleware
      .task("tests.getAllThrows.tmwEverywhereFunc")
      .throws([errE])
      .everywhere((task) => task.id.startsWith("tests.getAllThrows.funcTarget"))
      .run(async ({ next, task }) => next(task.input))
      .build();

    const matchingTask = r
      .task("tests.getAllThrows.funcTarget")
      .throws([errA])
      .run(async () => "ok")
      .build();

    const nonMatchingTask = r
      .task("tests.getAllThrows.noFuncTarget")
      .run(async () => "ok")
      .build();

    const app = r
      .resource("tests.getAllThrows.funcTargetApp")
      .register([funcMw, matchingTask, nonMatchingTask])
      .build();

    await withRuntime(app, (store) => {
      const matching = store.getAllThrows(matchingTask);
      expect(matching).toContain(errE.id);

      const nonMatching = store.getAllThrows(nonMatchingTask);
      expect(nonMatching).not.toContain(errE.id);
    });
  });

  it("collects throws from everywhere resource middleware (function form)", async () => {
    const funcRmw = r.middleware
      .resource("tests.getAllThrows.rmwEverywhereFunc")
      .throws([errF])
      .everywhere((res) => res.id.includes("funcResTarget"))
      .run(async ({ next }) => next())
      .build();

    const res = r
      .resource("tests.getAllThrows.funcResTarget")
      .throws([errA])
      .init(async () => 1)
      .build();

    const app = r
      .resource("tests.getAllThrows.funcResTargetApp")
      .register([funcRmw, res])
      .build();

    await withRuntime(app, (store) => {
      const result = store.getAllThrows(res);
      expect(result).toContain(errA.id);
      expect(result).toContain(errF.id);
    });
  });

  // ── Hook on array of events ───────────────────────────────────────────

  it("collects hook throws when hook listens to an array of events", async () => {
    const evA = r.event("tests.getAllThrows.evArr.a").build();
    const evB = r.event("tests.getAllThrows.evArr.b").build();

    const hook = r
      .hook("tests.getAllThrows.hookOnArr")
      .on([evA, evB])
      .throws([errC])
      .run(async () => {})
      .build();

    const task = r
      .task("tests.getAllThrows.taskEvArr")
      .dependencies({ evA })
      .run(async () => "ok")
      .build();

    const app = r
      .resource("tests.getAllThrows.evArrApp")
      .register([evA, evB, hook, task])
      .build();

    await withRuntime(app, (store) => {
      const result = store.getAllThrows(task);
      expect(result).toContain(errC.id);
    });
  });

  // ── Dependencies as function ──────────────────────────────────────────

  it("resolves dependencies given as a function", async () => {
    const dep = r
      .resource("tests.getAllThrows.lazyDep")
      .throws([errD])
      .init(async () => 99)
      .build();

    const task = r
      .task("tests.getAllThrows.lazyDepTask")
      .throws([errA])
      .dependencies(() => ({ dep }))
      .run(async () => "ok")
      .build();

    const app = r
      .resource("tests.getAllThrows.lazyDepApp")
      .register([dep, task])
      .build();

    await withRuntime(app, (store) => {
      const result = store.getAllThrows(task);
      expect(result).toContain(errA.id);
      expect(result).toContain(errD.id);
    });
  });

  // ── Optional resource dependency ──────────────────────────────────────

  it("unwraps optional resource dependencies", async () => {
    const optRes = r
      .resource("tests.getAllThrows.optRes")
      .throws([errB])
      .init(async () => 42)
      .build();

    const task = r
      .task("tests.getAllThrows.taskOptDep")
      .throws([errA])
      .dependencies({ optRes: optRes.optional() })
      .run(async () => "ok")
      .build();

    const app = r
      .resource("tests.getAllThrows.optResApp")
      .register([optRes, task])
      .build();

    await withRuntime(app, (store) => {
      const result = store.getAllThrows(task);
      expect(result).toContain(errA.id);
      expect(result).toContain(errB.id);
    });
  });

  // ── Shared resource dep (seen guard) ──────────────────────────────────

  it("deduplicates resource deps visited from multiple paths", async () => {
    const shared = r
      .resource("tests.getAllThrows.sharedRes")
      .throws([errC])
      .init(async () => "shared")
      .build();

    const parent = r
      .resource("tests.getAllThrows.parentRes")
      .throws([errB])
      .dependencies({ shared })
      .init(async () => "parent")
      .build();

    const task = r
      .task("tests.getAllThrows.taskShared")
      .throws([errA])
      .dependencies({ parent, shared })
      .run(async () => "ok")
      .build();

    const app = r
      .resource("tests.getAllThrows.sharedApp")
      .register([shared, parent, task])
      .build();

    await withRuntime(app, (store) => {
      const result = store.getAllThrows(task);
      // shared appears via parent AND directly, but errC only once
      expect(result).toContain(errA.id);
      expect(result).toContain(errB.id);
      expect(result).toContain(errC.id);
      expect(result.filter((id) => id === errC.id)).toHaveLength(1);
    });
  });
});
