import { definitions, r, asyncContext, createContext } from "../..";

describe("async context builder and defineAsyncContext", () => {
  it("builder.build produces context with id and custom serializer/parse", () => {
    type Ctx = { id: number };
    const ctx = r
      .asyncContext<Ctx>("tests.ctx.builder")
      .configSchema({
        parse(input: unknown) {
          const d = input as Ctx;
          if (typeof d?.id !== "number") throw new Error("invalid");
          return d;
        },
      })
      .serialize((v) => JSON.stringify({ id: v.id + 1 }))
      .parse((s) => {
        const j = JSON.parse(s);
        return { id: j.id - 1 };
      })
      .build();

    const encoded = ctx.serialize({ id: 1 });
    expect(encoded).toBe(JSON.stringify({ id: 2 }));
    const decoded = ctx.parse(encoded);
    expect(decoded).toEqual({ id: 1 });
  });

  it("asyncContext (define) honors provided serialize/parse over default", () => {
    const ctx = asyncContext<{ v: string }>({
      id: "tests.ctx.custom",
      configSchema: {
        parse(input: unknown) {
          const d = input as { v: string };
          if (typeof d?.v !== "string") throw new Error("invalid");
          return d;
        },
      },
      serialize: (d: { v: string }) => `#${d.v}`,
      parse: (s: string) => ({ v: s.slice(1) }),
    });

    const encoded = ctx.serialize({ v: "x" });
    expect(encoded).toBe("#x");
    const decoded = ctx.parse(encoded);
    expect(decoded).toEqual({ v: "x" });
  });

  it("default serializer/parse path works when no custom provided", () => {
    const ctx = createContext<{ when: Date }>("tests.ctx.default");
    const encoded = ctx.serialize({
      when: new Date("2024-01-01T00:00:00.000Z"),
    });
    const decoded = ctx.parse(encoded);
    expect(decoded.when).toBeInstanceOf(Date);
    expect(decoded.when.toISOString()).toBe("2024-01-01T00:00:00.000Z");
  });

  it("validates value via configSchema.parse on provide", async () => {
    const ctx = r
      .asyncContext<{ id: number }>("tests.ctx.schema")
      .configSchema({
        parse(input: unknown) {
          const d = input as { id: number };
          if (typeof d?.id !== "number") throw new Error("invalid");
          return d;
        },
      })
      .build();

    // Synchronous parse validation throws before returning Promise
    const bad: any = { id: "x" };
    expect(() => ctx.provide(bad, async () => undefined)).toThrow("invalid");
  });

  it("accepts meta in builder chain (smoke)", async () => {
    const ctx = r
      .asyncContext<{ id: number }>("tests.ctx.meta")
      .meta({ title: "Test Context", description: "A test context" })
      .build();

    await ctx.provide({ id: 1 }, async () => {
      expect(ctx.use()).toEqual({ id: 1 });
    });
  });

  it("captures symbolFilePath from the caller location", () => {
    const ctx = r.asyncContext<{ id: string }>("tests.ctx.filePath").build();

    expect(
      (ctx as unknown as Record<symbol, any>)[definitions.symbolFilePath],
    ).toBeDefined();
    expect(
      (ctx as unknown as Record<symbol, any>)[definitions.symbolFilePath],
    ).toContain("asyncContext.builder.test");
  });
});
