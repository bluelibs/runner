import { r, run, resources } from "../..";

describe("scoped override validation", () => {
  it("preserves isolation selectors on the original resource", async () => {
    const mailer = r
      .resource("mailer")
      .init(async () => "base")
      .build();
    const read = r
      .task("read")
      .dependencies({ mailer })
      .run(async (_, deps) => deps.mailer)
      .build();
    const b = r
      .resource("b")
      .register([read])
      .isolate({ only: [mailer] })
      .overrides([r.override(mailer, async () => "scoped")])
      .build();
    const runtime = await run(r.resource("app").register([mailer, b]).build());
    try {
      expect(await runtime.runTask(read)).toBe("scoped");
    } finally {
      await runtime.dispose();
    }
  });

  it("cannot use an override to reach a private resource", async () => {
    const mailer = r
      .resource("mailer")
      .init(async () => "base")
      .build();
    const owner = r
      .resource("owner")
      .register([mailer])
      .isolate({ exports: [] })
      .build();
    const b = r
      .resource("b")
      .overrides([r.override(mailer, async () => "scoped")])
      .build();
    await expect(
      run(r.resource("app").register([owner, b]).build()),
    ).rejects.toThrow(/is internal to resource/i);
  });

  it("rejects overrides of locked system resources", async () => {
    const app = r
      .resource("app")
      .overrides([
        r.override(resources.store, async (_, deps, context) => {
          return resources.store.init!(_, deps, context);
        }),
      ])
      .build();
    await expect(run(app)).rejects.toThrow(/cannot override/i);
  });
});
