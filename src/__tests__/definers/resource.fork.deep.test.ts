import type { RegisterableItems } from "../../defs";
import {
  symbolMiddlewareConfigured,
  symbolResourceForkedFrom,
  symbolTagConfigured,
} from "../../defs";
import { defineTask, isHook, isResourceWithConfig, isTask } from "../../define";
import { r, run } from "../../index";
import {
  assertRegisterArray,
  assertRegisterFn,
} from "./resource.fork.test.utils";

describe("IResource.fork() (deep)", () => {
  it("can deep-fork registered items with reId", async () => {
    const baseEvent = r.event("test.deep.event").build();
    const baseHook = r
      .hook("test.deep.hook")
      .on(baseEvent)
      .run(async () => undefined)
      .build();
    const baseTask = r
      .task("test.deep.task")
      .run(async () => "deep-ok")
      .build();

    const base = r
      .resource("base.deep")
      .register([baseEvent, baseHook, baseTask])
      .build();

    const reId = (id: string) => `forked.${id}`;
    const forked = base.fork("base.deep.forked", {
      register: "deep",
      reId,
    });

    assertRegisterArray(forked.register);
    const forkedRegister = forked.register;
    const forkedEvent = forkedRegister.find(
      (item) => item.id === reId(baseEvent.id),
    );
    const forkedHook = forkedRegister.find(
      (item) => item.id === reId(baseHook.id),
    );
    const forkedTask = forkedRegister.find(
      (item) => item.id === reId(baseTask.id),
    );

    expect(forkedEvent).toBeDefined();
    expect(forkedHook).toBeDefined();
    if (!forkedHook || !isHook(forkedHook)) {
      throw new Error("Expected forkedHook to be a hook");
    }
    if (forkedHook.on === "*" || Array.isArray(forkedHook.on)) {
      throw new Error("Expected forkedHook.on to be a single event definition");
    }
    expect(forkedHook.on.id).toBe(reId(baseEvent.id));

    const app = r.resource("app").register([base, forked]).build();
    const runtime = await run(app);

    expect(forkedTask).toBeDefined();
    if (!forkedTask || !isTask(forkedTask)) {
      throw new Error("Expected forkedTask to be a task");
    }
    const result = await runtime.runTask(forkedTask);
    expect(result).toBe("deep-ok");

    await runtime.dispose();
  });

  it("deep-forks all registerable types with reId", () => {
    const evA = r.event("test.deep.all.event.a").build();
    const evB = r.event("test.deep.all.event.b").build();
    const hookArray = r
      .hook("test.deep.all.hook.array")
      .on([evA, evB])
      .run(async () => undefined)
      .build();
    const hookStar = r
      .hook("test.deep.all.hook.star")
      .on("*")
      .run(async () => undefined)
      .build();

    const task = r
      .task("test.deep.all.task")
      .run(async () => "ok")
      .build();
    const phantom = defineTask.phantom({
      id: "test.deep.all.task.phantom",
      dependencies: {},
    });

    const taskMwBase = r.middleware
      .task("test.deep.all.mw.task.base")
      .run(async ({ next }) => next())
      .build();
    const taskMwConfigured = r.middleware
      .task<{ label: string }>("test.deep.all.mw.task.configured")
      .configSchema({ parse: (v) => v })
      .run(async ({ next }) => next())
      .build()
      .with({ label: "configured-task" });

    const resMwBase = r.middleware
      .resource("test.deep.all.mw.res.base")
      .run(async ({ next }) => next())
      .build();
    const resMwConfigured = r.middleware
      .resource<{ label: string }>("test.deep.all.mw.res.configured")
      .configSchema({ parse: (v) => v })
      .run(async ({ next }) => next())
      .build()
      .with({ label: "configured-resource" });

    const tagBase = r.tag("test.deep.all.tag.base").build();
    const tagConfigured = r
      .tag<{ level: string }>("test.deep.all.tag.configured")
      .configSchema({ parse: (v) => v })
      .build()
      .with({ level: "high" });

    const err = r.error<{ code: number }>("test.deep.all.error").build();
    const ctx = r.asyncContext<{ id: string }>("test.deep.all.ctx").build();

    const child = r.resource("test.deep.all.child").build();
    const childCfg = r
      .resource<{ name: string }>("test.deep.all.child.cfg")
      .init(async (cfg) => ({ name: cfg.name }))
      .build()
      .with({ name: "x" });

    const base = r
      .resource("test.deep.all.base")
      .register([
        evA,
        evB,
        hookArray,
        hookStar,
        task,
        phantom,
        taskMwBase,
        taskMwConfigured,
        resMwBase,
        resMwConfigured,
        tagBase,
        tagConfigured,
        err,
        ctx,
        child,
        childCfg,
      ])
      .build();

    const reId = (id: string) => `forked.${id}`;
    const forked = base.fork("test.deep.all.forked", {
      register: "deep",
      reId,
    });

    assertRegisterArray(forked.register);
    const forkedRegister = forked.register;

    const forkedHookArray = forkedRegister.find(
      (item) => item.id === reId(hookArray.id),
    );
    expect(forkedHookArray).toBeDefined();
    if (!forkedHookArray || !isHook(forkedHookArray)) {
      throw new Error("Expected forkedHookArray to be a hook");
    }
    if (!Array.isArray(forkedHookArray.on)) {
      throw new Error("Expected forkedHookArray.on to be an array of events");
    }
    expect(forkedHookArray.on.map((ev) => ev.id)).toEqual([
      reId(evA.id),
      reId(evB.id),
    ]);

    const forkedHookStar = forkedRegister.find(
      (item) => item.id === reId(hookStar.id),
    );
    expect(forkedHookStar).toBeDefined();
    if (!forkedHookStar || !isHook(forkedHookStar)) {
      throw new Error("Expected forkedHookStar to be a hook");
    }
    expect(forkedHookStar.on).toBe("*");

    const forkedTaskMwConfigured = forkedRegister.find(
      (item) => item.id === reId(taskMwConfigured.id),
    );
    expect(forkedTaskMwConfigured).toBeDefined();
    if (
      !forkedTaskMwConfigured ||
      !(symbolMiddlewareConfigured in forkedTaskMwConfigured)
    ) {
      throw new Error("Expected forkedTaskMwConfigured to be configured");
    }
    expect(forkedTaskMwConfigured).toEqual(
      expect.objectContaining({
        config: expect.objectContaining({ label: "configured-task" }),
      }),
    );

    const forkedResMwConfigured = forkedRegister.find(
      (item) => item.id === reId(resMwConfigured.id),
    );
    expect(forkedResMwConfigured).toBeDefined();
    if (
      !forkedResMwConfigured ||
      !(symbolMiddlewareConfigured in forkedResMwConfigured)
    ) {
      throw new Error("Expected forkedResMwConfigured to be configured");
    }
    expect(forkedResMwConfigured).toEqual(
      expect.objectContaining({
        config: expect.objectContaining({ label: "configured-resource" }),
      }),
    );

    const forkedTagConfigured = forkedRegister.find(
      (item) => item.id === reId(tagConfigured.id),
    );
    expect(forkedTagConfigured).toBeDefined();
    if (!forkedTagConfigured || !(symbolTagConfigured in forkedTagConfigured)) {
      throw new Error("Expected forkedTagConfigured to be configured");
    }
    expect(forkedTagConfigured).toEqual(
      expect.objectContaining({
        config: expect.objectContaining({ level: "high" }),
      }),
    );

    const forkedCtx = forkedRegister.find((item) => item.id === reId(ctx.id));
    expect(forkedCtx).toBeDefined();

    const forkedChildCfg = forkedRegister.find(
      (item) => item.id === reId(childCfg.resource.id),
    );
    expect(forkedChildCfg).toBeDefined();
    if (!forkedChildCfg || !isResourceWithConfig(forkedChildCfg)) {
      throw new Error("Expected forkedChildCfg to be a resource with config");
    }
    expect(forkedChildCfg).toEqual(
      expect.objectContaining({
        config: expect.objectContaining({ name: "x" }),
      }),
    );

    expect(forked[symbolResourceForkedFrom]?.fromId).toBe(base.id);
  });

  it("deep-fork caches duplicate registerables", () => {
    const task = r
      .task("test.deep.cache.task")
      .run(async () => "ok")
      .build();
    const base = r
      .resource("test.deep.cache.base")
      .register([task, task])
      .build();

    const forked = base.fork("test.deep.cache.forked", {
      register: "deep",
      reId: (id) => `forked.${id}`,
    });

    assertRegisterArray(forked.register);
    const forkedRegister = forked.register;
    expect(forkedRegister[0]).toBe(forkedRegister[1]);
  });

  it("deep-fork validates reId return value", () => {
    const task = r
      .task("test.deep.reid.task")
      .run(async () => "ok")
      .build();
    const base = r.resource("test.deep.reid.base").register([task]).build();

    expect(() =>
      base.fork("test.deep.reid.forked", {
        register: "deep",
        reId: () => "",
      }),
    ).toThrow("fork(reId) must return a non-empty string");
  });

  it("deep-fork supports register functions", () => {
    const task = r
      .task("test.deep.fn.task")
      .run(async () => "ok")
      .build();
    const base = r
      .resource("test.deep.fn.base")
      .register(() => [task])
      .build();

    const forked = base.fork("test.deep.fn.forked", {
      register: "deep",
      reId: (id) => `forked.${id}`,
    });

    assertRegisterFn(forked.register);
    const forkedRegister = forked.register(undefined);
    expect(forkedRegister[0].id).toBe("forked.test.deep.fn.task");
  });

  it("deep-fork uses the default reId prefix", () => {
    const task = r
      .task("test.deep.default.task")
      .run(async () => "ok")
      .build();
    const base = r.resource("test.deep.default.base").register([task]).build();

    const forked = base.fork("test.deep.default.forked", { register: "deep" });

    assertRegisterArray(forked.register);
    const forkedRegister = forked.register;
    expect(forkedRegister[0].id).toBe(
      "test.deep.default.forked.test.deep.default.task",
    );
  });

  it("deep-fork preserves unknown registerables", () => {
    const unknown = { id: "test.unknown.item" } as unknown as RegisterableItems;
    const base = r.resource("test.unknown.base").register([unknown]).build();

    const forked = base.fork("test.unknown.forked", {
      register: "deep",
      reId: (id) => `forked.${id}`,
    });

    assertRegisterArray(forked.register);
    const forkedRegister = forked.register;
    expect(forkedRegister[0]).toBe(unknown);
  });
});
