import { asyncContext as rawAsyncContextBuilder } from "../../definers/builders/asyncContext";

describe("asyncContext raw builder coverage", () => {
  it("exposes id and supports all fluent methods", () => {
    type T = { id: number };
    const b1 = rawAsyncContextBuilder<T>("tests.ctx.raw");
    expect(b1.id).toBe("tests.ctx.raw");

    const b2 = b1
      .serialize((d) => JSON.stringify(d))
      .parse((s) => JSON.parse(s))
      .configSchema({
        parse(input: unknown) {
          const d = input as T;
          if (typeof d?.id !== "number") throw new Error("invalid");
          return d;
        },
      });

    const ctx = b2.build();
    expect(ctx.id).toBe("tests.ctx.raw");
    // Exercise require() branch
    const mw = ctx.require();
    expect(mw).toBeTruthy();
  });
});
