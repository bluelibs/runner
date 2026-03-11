import { r, defineResource, run, defineTask } from "../..";
import { override } from "../../definers/builders/override";
import {
  defineEvent,
  defineHook,
  defineOverride,
  defineResourceMiddleware,
  defineTaskMiddleware,
} from "../../define";

describe("override() helper", () => {
  it("should preserve id and override run for tasks", async () => {
    const base = defineTask({
      id: "test-task",
      run: async () => "base",
    });

    const changed = override(base, async () => "changed");

    expect(changed).not.toBe(base);
    expect(changed.id).toBe(base.id);
    expect(await base.run(undefined, {})).toBe("base");
    expect(await changed.run(undefined, {})).toBe("changed");
  });

  it("should preserve id and override init for resources", async () => {
    const base = defineResource({
      id: "test-resource",
      init: async () => 1,
    });

    const changed = override(base, async () => 2);

    expect(changed).not.toBe(base);
    expect(changed.id).toBe(base.id);

    const v1 = await base.init!(undefined, {}, undefined);
    const v2 = await changed.init!(undefined, {}, undefined);
    expect(v1).toBe(1);
    expect(v2).toBe(2);
  });

  it("should preserve id and override run for task middleware", async () => {
    const mw = defineTaskMiddleware({
      id: "test-middleware",
      run: async ({ next }) => {
        return next();
      },
    });

    const changed = override(mw, async ({ task, next }) => {
      const result = await next(task?.input as any);
      return { wrapped: result } as any;
    });

    expect(changed).not.toBe(mw);
    expect(changed.id).toBe(mw.id);

    const input = {
      task: { definition: undefined as any, input: 123 },
      next: async () => 456,
    } as any;

    const baseResult = await mw.run(input, {}, undefined);
    const changedResult = await changed.run(input, {}, undefined);
    expect(baseResult).toBe(456);
    expect(changedResult).toEqual({ wrapped: 456 });
  });

  it("should preserve id and override run for hooks", async () => {
    const myEvent = defineEvent({ id: "test-event" });

    let value = 0;
    const hook = defineHook({
      id: "test-hook",
      on: myEvent,
      run: async () => (value = 1),
    });

    const changed = override(hook, async () => (value = 2));

    expect(changed).not.toBe(hook);
    expect(changed.id).toBe(hook.id);

    const app = defineResource({
      id: "app",
      register: [hook, myEvent],
      dependencies: { myEvent },
      async init(_, { myEvent }) {
        await myEvent();
      },
    });

    const wrap = defineResource({
      id: "wrap",
      register: [app],
      overrides: [changed],
    });

    await run(wrap);
    expect(value).toBe(2);
  });

  it("should keep middleware overrides when configuring with .with()", async () => {
    const taskMiddleware = defineTaskMiddleware<{ label: string }>({
      id: "test-middleware-with-task",
      run: async ({ next }) => `base:${await next()}`,
    });
    const resourceMiddleware = defineResourceMiddleware<{ label: string }>({
      id: "test-middleware-with-resource",
      run: async ({ next }) => `base:${await next()}`,
    });

    const taskOverride = override(taskMiddleware, async ({ next }) => {
      return `changed:${await next()}`;
    });
    const resourceOverride = override(resourceMiddleware, async ({ next }) => {
      return `changed:${await next()}`;
    });

    const taskConfigured = taskOverride.with({ label: "task" });
    const resourceConfigured = resourceOverride.with({ label: "resource" });

    const taskInput = {
      task: { definition: undefined as any, input: "payload" },
      next: async () => "ok",
    } as any;
    const resourceInput = {
      resource: { definition: undefined as any, config: {} },
      next: async () => "ok",
    } as any;

    const taskResult = await taskConfigured.run(
      taskInput,
      {},
      taskConfigured.config,
    );
    const resourceResult = await resourceConfigured.run(
      resourceInput,
      {},
      resourceConfigured.config,
    );

    expect(taskResult).toBe("changed:ok");
    expect(resourceResult).toBe("changed:ok");
  });

  it("should behave like r.override for task overrides", async () => {
    const baseTask = r
      .task("test-alias-task")
      .run(async () => "base")
      .build();
    const viaAlias = override(baseTask, async () => "alias");
    const viaNamespace = r.override(baseTask, async () => "namespace");

    const app = r
      .resource("test-alias-app")
      .register([baseTask])
      .overrides([viaAlias, viaNamespace])
      .build();

    await expect(run(app)).rejects.toThrow(
      'Override target "test-alias-task" is declared more than once.',
    );
  });

  it("should ignore null and undefined overrides", async () => {
    const base = defineTask({
      id: "test-task-nullable",
      run: async () => "base",
    });

    const changed = override(base, async () => "changed");

    const app = defineResource({
      id: "app-nullable-overrides",
      register: [base],
      overrides: [changed, null, undefined],
      dependencies: { base },
      init: async (_, deps) => deps.base(),
    });

    const result = await run(app);
    expect(result.value).toBe("changed");
  });

  it("should reject patch-form usage at runtime", () => {
    const base = defineTask({
      id: "test-task-runtime-patch-rejected",
      run: async () => "base",
    });

    const runtimeOverride = override as unknown as (
      base: unknown,
      fn?: unknown,
    ) => unknown;

    expect(() =>
      runtimeOverride(base, {
        run: async () => "changed",
      }),
    ).toThrow(/second argument must be a function/);
  });

  it("should reject patch-form defineOverride usage at runtime", () => {
    const base = defineTask({
      id: "test-task-runtime-patch-rejected-define",
      run: async () => "base",
    });

    const runtimeDefineOverride = defineOverride as unknown as (
      base: unknown,
      fn?: unknown,
    ) => unknown;

    expect(() =>
      runtimeDefineOverride(base, {
        run: async () => "changed",
      }),
    ).toThrow(/second argument must be a function/);
  });

  it("should throw when fn shorthand is provided with an unrecognized base type", () => {
    const unknownBase = { id: "unknown", __type: "alien" } as any;
    expect(() => override(unknownBase, async () => "noop")).toThrow(/override/);
  });

  it("supports defineOverride as the same override contract as r.override", async () => {
    const baseTask = defineTask({
      id: "test-override-define-equals-r-base",
      run: async () => "base",
    });
    const highLevelOverride = defineOverride(baseTask, async () => "changed");

    expect(await highLevelOverride.run(undefined, {})).toBe("changed");

    const app = defineResource({
      id: "test-override-define-equals-r-app",
      register: [baseTask],
      overrides: [highLevelOverride],
      dependencies: { baseTask },
      init: async (_config, deps) => deps.baseTask(),
    });

    const result = await run(app);
    expect(result.value).toBe("changed");
  });
});
