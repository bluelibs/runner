import { definitions, task, resource, override, run } from "..";
import {
  defineEvent,
  defineHook,
  defineResource,
  defineTaskMiddleware,
} from "../define";

describe("override() helper", () => {
  it("should preserve id and override run for tasks", async () => {
    const base = task({
      id: "test.task",
      run: async () => "base",
    });

    const changed = override(base, {
      run: async () => "changed",
      meta: { title: "Updated" },
    });

    expect(changed).not.toBe(base);
    expect(changed.id).toBe(base.id);
    expect(await base.run(undefined as any, {} as any)).toBe("base");
    expect(await changed.run(undefined as any, {} as any)).toBe("changed");
    expect(changed.meta?.title).toBe("Updated");
  });

  it("should preserve id and override init for resources", async () => {
    const base = resource({
      id: "test.resource",
      init: async () => 1,
    });

    const changed = override(base, {
      init: async () => 2,
      meta: { description: "Updated" },
    });

    expect(changed).not.toBe(base);
    expect(changed.id).toBe(base.id);
    // Call the init functions directly (without runner) to validate override
    // Signatures: init(config, deps, ctx)

    const v1 = await base.init!(undefined as any, {} as any, undefined as any);

    const v2 = await changed.init!(
      undefined as any,
      {} as any,
      undefined as any,
    );
    expect(v1).toBe(1);
    expect(v2).toBe(2);
    expect(changed.meta?.description).toBe("Updated");
  });

  it("should preserve id and override run for task middleware", async () => {
    const mw = defineTaskMiddleware({
      id: "test.middleware",
      run: async ({ next }) => {
        return next();
      },
    });

    const changed = override(mw, {
      run: async ({ task, next }) => {
        const result = await next(task?.input as any);
        return { wrapped: result } as any;
      },
    });

    expect(changed).not.toBe(mw);
    expect(changed.id).toBe(mw.id);

    const input: definitions.ITaskMiddlewareExecutionInput<any> = {
      task: { definition: undefined as any, input: 123 },
      next: async () => 456,
    } as any;

    const baseResult = await mw.run(input, {} as any, undefined as any);
    const changedResult = await changed.run(input, {} as any, undefined as any);
    expect(baseResult).toBe(456);
    expect(changedResult).toEqual({ wrapped: 456 });
  });

  it("should be type-safe: cannot override id on task/resource/middleware", () => {
    const t = task({ id: "tt", run: async () => undefined });
    const r = resource({ id: "rr", init: async () => undefined });
    const m = defineTaskMiddleware({
      id: "mm",
      run: async ({ next }) => next(),
    });

    // @ts-expect-error id cannot be overridden
    override(t, { id: "new" });

    // @ts-expect-error id cannot be overridden
    override(r, { id: "new" });

    // @ts-expect-error id cannot be overridden
    override(m, { id: "new" });

    expect(true).toBe(true);
  });

  it("should work correctly with hook overrides", async () => {
    const myEvent = defineEvent({ id: "test.event" });

    let value = 0;
    const hook = defineHook({
      id: "test.hook",
      on: myEvent,
      run: async () => (value = 1),
    });

    const changed = override(hook, {
      run: async () => (value = 2),
      meta: {
        title: "Updated",
      },
    });

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

  it("should just ignore and allow null and undefined overrides", async () => {
    const base = task({
      id: "test.task",
      run: async () => "base",
    });

    const changed = override(base, {
      run: async () => "changed",
      meta: { title: "Updated" },
    });

    const app = defineResource({
      id: "app",
      register: [base],
      overrides: [changed, null, undefined],
    });

    const result = await run(app);
    await expect(result.runTask(base)).resolves.toBe("base");
  });
});
