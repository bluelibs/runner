import { definitions, task, resource, middleware, override } from "..";

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
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const v1 = await base.init!(undefined as any, {} as any, undefined as any);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const v2 = await changed.init!(
      undefined as any,
      {} as any,
      undefined as any
    );
    expect(v1).toBe(1);
    expect(v2).toBe(2);
    expect(changed.meta?.description).toBe("Updated");
  });

  it("should preserve id and override run for middleware", async () => {
    const mw = middleware({
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

    const input = {
      task: { definition: undefined as any, input: 123 },
      next: async () => 456,
    } as definitions.IMiddlewareExecutionInput<any, any>;

    const baseResult = await mw.run(input, {} as any, undefined as any);
    const changedResult = await changed.run(input, {} as any, undefined as any);
    expect(baseResult).toBe(456);
    expect(changedResult).toEqual({ wrapped: 456 });
  });

  it("should be type-safe: cannot override id on task/resource/middleware", () => {
    const t = task({ id: "tt", run: async () => undefined });
    const r = resource({ id: "rr", init: async () => undefined });
    const m = middleware({ id: "mm", run: async ({ next }) => next() });

    // @ts-expect-error id cannot be overridden
    override(t, { id: "new" });

    // @ts-expect-error id cannot be overridden
    override(r, { id: "new" });

    // @ts-expect-error id cannot be overridden
    override(m, { id: "new" });

    expect(true).toBe(true);
  });

  it("should handle undefined patch (robustness)", () => {
    const base = task({ id: "robust.task", run: async () => 1 });
    const changed = (override as any)(base, undefined);

    expect(changed).not.toBe(base);
    expect(changed.id).toBe(base.id);
    expect(changed.run).toBe(base.run);
  });
});
