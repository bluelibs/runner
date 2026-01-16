import { r, run } from "../index";

describe("IResource.fork()", () => {
  it("creates a new resource with a different id", () => {
    const base = r
      .resource<{ value: string }>("base.resource")
      .init(async (cfg) => ({ msg: cfg.value }))
      .build();

    const forked = base.fork("forked.resource");

    expect(forked.id).toBe("forked.resource");
    expect(base.id).toBe("base.resource");
  });

  it("preserves the type signature and config shape", async () => {
    const base = r
      .resource<{ host: string; port: number }>("base.db")
      .init(async (cfg) => ({ connectionString: `${cfg.host}:${cfg.port}` }))
      .build();

    const forked = base.fork("replica.db");

    // Configure both with the same shape
    const app = r
      .resource("app")
      .register([
        base.with({ host: "primary", port: 5432 }),
        forked.with({ host: "replica", port: 5433 }),
      ])
      .build();

    const runtime = await run(app);
    const primary = runtime.getResourceValue(base);
    const replica = runtime.getResourceValue(forked);

    expect(primary.connectionString).toBe("primary:5432");
    expect(replica.connectionString).toBe("replica:5433");

    await runtime.dispose();
  });

  it("forked resources work as independent dependencies", async () => {
    const base = r
      .resource<{ value: string }>("base.mailer")
      .init(async (cfg) => ({ msg: cfg.value }))
      .build();

    const fork1 = base.fork("mailer.transactional");
    const fork2 = base.fork("mailer.marketing");

    const consumer = r
      .task("test.consumer")
      .dependencies({ tx: fork1, mkt: fork2 })
      .run(async (_, { tx, mkt }) => ({ a: tx.msg, b: mkt.msg }))
      .build();

    const app = r
      .resource("app")
      .register([
        fork1.with({ value: "transactional" }),
        fork2.with({ value: "marketing" }),
        consumer,
      ])
      .build();

    const runtime = await run(app);
    const result = await runtime.runTask(consumer);

    expect(result).toEqual({ a: "transactional", b: "marketing" });

    await runtime.dispose();
  });

  it("inherits tags from the base resource", () => {
    const myTag = r.tag("test.tag").build();

    const base = r.resource("base.tagged").tags([myTag]).build();

    const forked = base.fork("forked.tagged");

    expect(forked.tags).toHaveLength(1);
    expect(forked.tags[0].id).toBe("test.tag");
  });

  it("allows chaining fork().with()", async () => {
    const base = r
      .resource<{ name: string }>("base.service")
      .init(async (cfg) => ({ greeting: `Hello, ${cfg.name}` }))
      .build();

    const configured = base.fork("custom.service").with({ name: "World" });

    const app = r.resource("app").register([configured]).build();

    const runtime = await run(app);
    const value = runtime.getResourceValue(base.fork("custom.service"));

    expect(value.greeting).toBe("Hello, World");

    await runtime.dispose();
  });

  it("forked resources have separate runtime instances", async () => {
    let initCount = 0;

    const base = r
      .resource<{ id: string }>("base.counter")
      .init(async (cfg) => {
        initCount++;
        return { id: cfg.id, instanceNumber: initCount };
      })
      .build();

    const fork1 = base.fork("counter.one");
    const fork2 = base.fork("counter.two");

    const app = r
      .resource("app")
      .register([fork1.with({ id: "one" }), fork2.with({ id: "two" })])
      .build();

    const runtime = await run(app);

    const v1 = runtime.getResourceValue(fork1);
    const v2 = runtime.getResourceValue(fork2);

    expect(v1.id).toBe("one");
    expect(v2.id).toBe("two");
    expect(v1.instanceNumber).not.toBe(v2.instanceNumber);
    expect(initCount).toBe(2);

    await runtime.dispose();
  });

  it("preserves middleware from base resource", () => {
    const mw = r.middleware
      .resource("test.mw")
      .run(async ({ next }) => next())
      .build();

    const base = r.resource("base.with.mw").middleware([mw]).build();

    const forked = base.fork("forked.with.mw");

    expect(forked.middleware).toHaveLength(1);
  });
});
