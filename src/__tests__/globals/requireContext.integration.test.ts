import { middleware, r, run } from "../../index";
import type { IAsyncContext } from "../../index";

async function assertRequiredContext<T>(context: IAsyncContext<T>, value: T) {
  const handler = jest.fn(async () => context.use());
  const protectedTask = r
    .task("protectedTask")
    .middleware([middleware.task.requireContext.with({ context })])
    .run(handler)
    .build();
  const app = r.resource("app").register([protectedTask]).build();
  const runtime = await run(app, { logs: { printThreshold: null } });

  try {
    await expect(runtime.runTask(protectedTask)).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();

    const result = await context.provide(value, () =>
      runtime.runTask(protectedTask),
    );
    expect(result).toEqual(value);
    expect(handler).toHaveBeenCalledTimes(1);

    await expect(runtime.runTask(protectedTask)).rejects.toThrow();
    expect(handler).toHaveBeenCalledTimes(1);
  } finally {
    await runtime.dispose();
  }
}

describe("requireContext with real async contexts", () => {
  it("guards a primitive context", async () => {
    const context = r.asyncContext<string>("primitive").build();
    await assertRequiredContext(context, "value");
  });

  it("guards an object context", async () => {
    const context = r.asyncContext<{ userId: string }>("object").build();
    await assertRequiredContext(context, { userId: "u1" });
  });

  it("guards a schema-backed context", async () => {
    const context = r
      .asyncContext("validated")
      .schema({ userId: String })
      .build();
    await assertRequiredContext(context, { userId: "u1" });
  });
});
