import { defineResource } from "../define";
import { run } from "../run";
import { r } from "../index";
import { defineTask } from "../definers/defineTask";

describe("asyncContext as dependency", () => {
  it("injects the asyncContext helper when registered", async () => {
    const ctx = r.asyncContext<{ id: string }>("spec.ctx.dep").build();

    const t = defineTask<void, Promise<string>>({
      id: "spec.tasks.ctx.dep",
      dependencies: { ctx },
      run: async (_input, { ctx }) => {
        return ctx.use().id;
      },
    });

    const app = defineResource({ id: "spec.app.ctx.dep", register: [ctx, t] });
    const runtime = await run(app);

    const result = await ctx.provide({ id: "abc" }, async () => {
      return runtime.runTask(t, undefined as any);
    });

    expect(result).toBe("abc");

    await runtime.dispose();
  });

  it("throws if non-optional asyncContext dependency is not registered", async () => {
    const ctx = r.asyncContext<{ id: string }>("spec.ctx.dep.missing").build();
    const t = defineTask<void, Promise<string>>({
      id: "spec.tasks.ctx.dep.missing",
      dependencies: { ctx },
      run: async (_i, { ctx }) => ctx.use().id,
    });
    const app = defineResource({
      id: "spec.app.ctx.dep.missing",
      register: [t],
    });
    await expect(run(app)).rejects.toThrow();
  });

  it("supports optional asyncContext dependencies (present/absent)", async () => {
    const ctx = r.asyncContext<{ who: string }>("spec.ctx.dep.opt").build();

    const withOpt = defineTask<void, Promise<string | undefined>>({
      id: "spec.tasks.ctx.dep.opt.present",
      dependencies: { ctx: ctx.optional() },
      run: async (_i, { ctx }) => {
        return ctx?.id;
      },
    });

    const withOptApp = defineResource({
      id: "spec.app.ctx.dep.opt.present",
      register: [ctx, withOpt],
    });
    const rr1 = await run(withOptApp);
    expect(await rr1.runTask(withOpt, undefined as any)).toBe(ctx.id);
    await rr1.dispose();

    const withoutOpt = defineTask<void, Promise<undefined>>({
      id: "spec.tasks.ctx.dep.opt.absent",
      dependencies: { ctx: ctx.optional() },
      run: async (_i, { ctx }) => {
        return ctx?.id as any;
      },
    });

    const withoutOptApp = defineResource({
      id: "spec.app.ctx.dep.opt.absent",
      register: [withoutOpt],
    });
    const rr2 = await run(withoutOptApp);
    expect(await rr2.runTask(withoutOpt, undefined as any)).toBeUndefined();
    await rr2.dispose();
  });
});
