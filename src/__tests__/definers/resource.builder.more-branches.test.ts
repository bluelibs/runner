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

  it("init handles context state via the classic signature", async () => {
    const a = resource({ id: "tests.builder.init.obj.a", init: async () => 5 });
    const app = r
      .resource("tests.builder.init.obj")
      .register([a])
      .dependencies({ a })
      .context(() => ({ hits: 0 }))
      .init(async (_cfg, deps, ctx) => {
        ctx.hits++;
        return Promise.resolve(deps.a + ctx.hits);
      })
      .build();

    const rr = await run(app);
    expect(rr.value).toBe(6);
    await rr.dispose();
  });

  it("init single-arg config signature works", async () => {
    const app = r
      .resource("tests.builder.init.singlearg")
      .init(async (_cfg: void) => {
        return Promise.resolve("ok");
      })
      .build();

    const rr = await run(app);
    expect(rr.value).toBe("ok");
    await rr.dispose();
  });

  it("init zero-argument function remains compatible", async () => {
    function zeroInit() {
      return Promise.resolve("zero");
    }

    const app = r.resource("tests.builder.init.zero").init(zeroInit).build();

    const rr = await run(app);
    expect(rr.value).toBe("zero");
    await rr.dispose();
  });

  it("init accepts arrow functions without parentheses", async () => {
    // Using an arrow without parentheses exercises the builder when length-based heuristics
    // are inconclusive; the function should still be wired unchanged.
    const fn: any = eval("cfg => 11");

    const app = r
      .resource("tests.builder.init.arrow.noparens")
      .init(fn)
      .build();

    const rr = await run(app);
    expect(rr.value).toBe(11);
    await rr.dispose();
  });

  it("init accepts proxied functions", async () => {
    const base = () => Promise.resolve("exotic");
    const proxied = new Proxy(base, {
      get(target, prop, receiver) {
        if (prop === "toString") {
          return () => "fnWithoutParens";
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const app = r
      .resource("tests.builder.init.exotic")
      .init(proxied as any)
      .build();

    const rr = await run(app);
    expect(rr.value).toBe("exotic");
    await rr.dispose();
  });

  it("resource dependencies append by default and override when requested", async () => {
    const a = resource({ id: "tests.builder.deps.a", init: async () => 5 });
    const b = resource({ id: "tests.builder.deps.b", init: async () => 7 });

    const appAppend = r
      .resource("tests.builder.deps.append")
      .register([a, b])
      .dependencies(() => ({ a }))
      .dependencies({ b })
      .init(async (_cfg, deps: { a: number; b: number }) => deps.a + deps.b)
      .build();

    const rr1 = await run(appAppend);
    expect(rr1.value).toBe(12);
    await rr1.dispose();

    const appOverride = r
      .resource("tests.builder.deps.override")
      .register([a, b])
      .dependencies({ a })
      .dependencies({ b }, { override: true })
      .init(async (_cfg, deps: { b: number }) => deps.b)
      .build();

    const rr2 = await run(appOverride);
    expect(rr2.value).toBe(7);
    await rr2.dispose();
  });

  it("resource dependencies object+object append branch", async () => {
    const a = resource({
      id: "tests.builder.resdeps.oo.a",
      init: async () => 1,
    });
    const b = resource({
      id: "tests.builder.resdeps.oo.b",
      init: async () => 2,
    });
    const app = r
      .resource("tests.builder.resdeps.oo")
      .register([a, b])
      .dependencies({ a })
      .dependencies({ b })
      .init(async (_cfg, deps: { a: number; b: number }) => deps.a + deps.b)
      .build();
    const rr = await run(app);
    expect(rr.value).toBe(3);
    await rr.dispose();
  });
});
