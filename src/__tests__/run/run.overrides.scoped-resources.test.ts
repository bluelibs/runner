import { r, run } from "../..";

const mailer = r
  .resource("mailer")
  .init(async () => ({ name: "original" }))
  .build();
const reader = (id: string) =>
  r
    .task(id)
    .dependencies({ mailer })
    .run(async (_, { mailer }) => mailer)
    .build();

describe("subtree resource overrides", () => {
  it.each(["dev", "prod", "test"] as const)(
    "isolates siblings and inherits the nearest declaration in %s",
    async (mode) => {
      const rootRead = reader("rootRead");
      const bRead = reader("bRead");
      const inheritedRead = reader("inheritedRead");
      const leafRead = reader("leafRead");
      const cRead = reader("cRead");
      const leaf = r
        .resource("leaf")
        .register([leafRead])
        .overrides([r.override(mailer, async () => ({ name: "leaf" }))])
        .build();
      const b = r
        .resource("b")
        .register([
          bRead,
          leaf,
          r.resource("nested").register([inheritedRead]).build(),
        ])
        .overrides([r.override(mailer, async () => ({ name: "b" }))])
        .build();
      const c = r
        .resource("c")
        .register([cRead])
        .overrides([r.override(mailer, async () => ({ name: "c" }))])
        .build();
      const app = r
        .resource("app")
        .register([mailer, rootRead, b, c])
        .overrides([r.override(mailer, async () => ({ name: "root" }))])
        .build();
      const runtime = await run(app, { mode });
      try {
        expect(await runtime.runTask(rootRead)).toEqual({ name: "root" });
        const bValue = await runtime.runTask(bRead);
        expect(bValue).toEqual({ name: "b" });
        expect(await runtime.runTask(inheritedRead)).toBe(bValue);
        expect(await runtime.runTask(leafRead)).toEqual({ name: "leaf" });
        expect(await runtime.runTask(cRead)).toEqual({ name: "c" });
      } finally {
        await runtime.dispose();
      }
    },
  );

  it("keeps shared services and cross-subtree calls bound to their registration scope", async () => {
    const cRead = reader("cRead");
    const shared = r
      .resource("shared")
      .dependencies({ mailer })
      .init(async (_, deps) => deps.mailer)
      .build();
    const bRead = r
      .task("bRead")
      .dependencies({ mailer, shared, cRead })
      .run(async (_, deps) => [
        deps.mailer.name,
        deps.shared.name,
        (await deps.cRead()).name,
      ])
      .build();
    const b = r
      .resource("b")
      .register([bRead])
      .overrides([r.override(mailer, async () => ({ name: "b" }))])
      .build();
    const c = r.resource("c").register([cRead]).build();
    const app = r.resource("app").register([mailer, shared, b, c]).build();
    const runtime = await run(app);
    try {
      expect(await runtime.runTask(bRead)).toEqual([
        "b",
        "original",
        "original",
      ]);
    } finally {
      await runtime.dispose();
    }
  });

  it("preserves the original for outside consumers when the owner overrides its own resource", async () => {
    const bRead = reader("bRead");
    const outsideRead = reader("outsideRead");
    const b = r
      .resource("b")
      .register([mailer, bRead])
      .overrides([r.override(mailer, async () => ({ name: "b" }))])
      .build();
    const app = r.resource("app").register([b, outsideRead]).build();
    const runtime = await run(app);
    try {
      expect(await runtime.runTask(bRead)).toEqual({ name: "b" });
      expect(await runtime.runTask(outsideRead)).toEqual({ name: "original" });
    } finally {
      await runtime.dispose();
    }
  });

  it("keeps parallel containers and optional resource dependencies independent", async () => {
    const read = r
      .task("read")
      .dependencies({ mailer: mailer.optional() })
      .run(async (_, deps) => deps.mailer)
      .build();
    const b = r
      .resource("b")
      .register([read])
      .overrides([r.override(mailer, async () => ({ name: "b" }))])
      .build();
    const app = r.resource("app").register([mailer, b]).build();
    const [first, second] = await Promise.all([run(app), run(app)]);
    try {
      expect(await first.runTask(read)).not.toBe(await second.runTask(read));
    } finally {
      await Promise.all([first.dispose(), second.dispose()]);
    }
  });

  it.each(["test", "prod"] as const)(
    "rejects duplicate targets at the same boundary in %s",
    async (mode) => {
      const app = r
        .resource("app")
        .register([mailer])
        .overrides([
          r.override(mailer, async () => ({ name: "one" })),
          r.override(mailer, async () => ({ name: "two" })),
        ])
        .build();
      await expect(run(app, { mode })).rejects.toThrow(
        /declared more than once/,
      );
    },
  );
});
