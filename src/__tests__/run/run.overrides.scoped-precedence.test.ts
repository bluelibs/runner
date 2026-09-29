import { r, run } from "../..";

describe("subtree override compatibility", () => {
  it("lets a root test harness replace sibling overrides without initializing the shadowed instances", async () => {
    const original = jest.fn(async () => ({ name: "original" }));
    const bInit = jest.fn(async () => ({ name: "b" }));
    const cInit = jest.fn(async () => ({ name: "c" }));
    const rootInit = jest.fn(async () => ({ name: "test" }));
    const mailer = r.resource("mailer").init(original).build();
    const readB = r
      .task("readB")
      .dependencies({ mailer })
      .run(async (_, deps) => deps.mailer)
      .build();
    const readC = r
      .task("readC")
      .dependencies({ mailer })
      .run(async (_, deps) => deps.mailer)
      .build();
    const b = r
      .resource("b")
      .register([readB])
      .overrides([r.override(mailer, bInit)])
      .build();
    const c = r
      .resource("c")
      .register([readC])
      .overrides([r.override(mailer, cInit)])
      .build();
    const app = r.resource("app").register([mailer, b, c]).build();
    const harness = r
      .resource("harness")
      .register([app])
      .overrides([r.override(mailer, rootInit)])
      .build();
    const runtime = await run(harness, { mode: "test" });
    try {
      const value = await runtime.runTask(readB);
      expect(value).toEqual({ name: "test" });
      expect(await runtime.runTask(readC)).toBe(value);
      expect(rootInit).toHaveBeenCalledTimes(1);
      expect(original).not.toHaveBeenCalled();
      expect(bInit).not.toHaveBeenCalled();
      expect(cInit).not.toHaveBeenCalled();
      const definitions = runtime.inspect().snapshot().definitions;
      expect(definitions.filter((entry) => entry.override)).toHaveLength(1);
      expect(
        runtime.inspect().explain(mailer).override?.declaredByResourceId,
      ).toBe("harness");
    } finally {
      await runtime.dispose();
    }
  });

  it("rejects duplicate declarations before initialization even when a test harness would hide them", async () => {
    const first = jest.fn(async () => "first");
    const last = jest.fn(async () => "last");
    const mailer = r
      .resource("mailer")
      .init(async () => "original")
      .build();
    const read = r
      .task("read")
      .dependencies({ mailer })
      .run(async (_, deps) => deps.mailer)
      .build();
    const b = r
      .resource("b")
      .register([read])
      .overrides([r.override(mailer, first), r.override(mailer, last)])
      .build();
    const rootInit = jest.fn(async () => "root");
    const app = r
      .resource("app")
      .register([mailer, b])
      .overrides([r.override(mailer, rootInit)])
      .build();
    await expect(run(app, { mode: "test" })).rejects.toThrow(
      /declared more than once/,
    );
    expect(first).not.toHaveBeenCalled();
    expect(last).not.toHaveBeenCalled();
    expect(rootInit).not.toHaveBeenCalled();
  });

  it("keeps parent priority inside its scope while a sibling retains its independent override", async () => {
    const mailer = r
      .resource("mailer")
      .init(async () => "original")
      .build();
    const readLeaf = r
      .task("readLeaf")
      .dependencies({ mailer })
      .run(async (_, deps) => deps.mailer)
      .build();
    const readC = r
      .task("readC")
      .dependencies({ mailer })
      .run(async (_, deps) => deps.mailer)
      .build();
    const leafInit = jest.fn(async () => "leaf");
    const leaf = r
      .resource("leaf")
      .register([readLeaf])
      .overrides([r.override(mailer, leafInit)])
      .build();
    const b = r
      .resource("b")
      .register([leaf])
      .overrides([r.override(mailer, async () => "b")])
      .build();
    const c = r
      .resource("c")
      .register([readC])
      .overrides([r.override(mailer, async () => "c")])
      .build();
    const runtime = await run(
      r.resource("app").register([mailer, b, c]).build(),
      { mode: "test" },
    );
    try {
      expect(await runtime.runTask(readLeaf)).toBe("b");
      expect(await runtime.runTask(readC)).toBe("c");
      expect(leafInit).not.toHaveBeenCalled();
    } finally {
      await runtime.dispose();
    }
  });

  it.each(["dev", "prod", "pre-prod"] as const)(
    "retains overlapping resource rejection in %s",
    async (mode) => {
      const mailer = r
        .resource("mailer")
        .init(async () => "original")
        .build();
      const b = r
        .resource("b")
        .overrides([r.override(mailer, async () => "b")])
        .build();
      const app = r
        .resource("app")
        .register([mailer, b])
        .overrides([r.override(mailer, async () => "root")])
        .build();
      await expect(run(app, { mode })).rejects.toThrow(
        /declared more than once/,
      );
    },
  );
});
