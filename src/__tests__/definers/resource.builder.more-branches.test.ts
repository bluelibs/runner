import { r, resource, run } from "../..";

describe("resource builder - register function+function merge branch", () => {
  it("merges two function-based registers preserving order", () => {
    const a = resource({ id: "tests.builder.fnfn.a", init: async () => 1 });
    const b = resource({ id: "tests.builder.fnfn.b", init: async () => 2 });

    const composed = r
      .resource("tests.builder.fnfn")
      .register(() => [a])
      .register(() => [b])
      .build();

    expect(typeof composed.register).toBe("function");
    if (typeof composed.register === "function") {
      const ids = composed.register({} as any).map((it) => it.id);
      expect(ids).toEqual([a.id, b.id]);
    }
  });

  it("init accepts traditional (config, deps, ctx) signature", async () => {
    const a = resource({
      id: "tests.builder.init.trad.a",
      init: async () => 1,
    });
    const b = resource({
      id: "tests.builder.init.trad.b",
      init: async () => 2,
    });

    const app = r
      .resource("tests.builder.init.trad")
      .register([a, b])
      .dependencies({ a, b })
      .context(() => ({ c: 0 }))
      .init(
        async (
          _cfg: void,
          deps: { a: number; b: number },
          ctx: { c: number },
        ) => {
          ctx.c++;
          return Promise.resolve(deps.a + deps.b + ctx.c);
        },
      )
      .build();

    const rr = await run(app);
    expect(rr.value).toBe(4);
    await rr.dispose();
  });

  it("init object-style works (preferred)", async () => {
    const a = resource({ id: "tests.builder.init.obj.a", init: async () => 5 });
    const app = r
      .resource("tests.builder.init.obj")
      .register([a])
      .dependencies({ a })
      .context(() => ({ hits: 0 }))
      .init(async ({ deps, ctx }) => {
        ctx.hits++;
        return Promise.resolve(deps.a + ctx.hits);
      })
      .build();

    const rr = await run(app);
    expect(rr.value).toBe(6);
    await rr.dispose();
  });
});
