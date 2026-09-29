import { r, run } from "../..";

describe("scoped override consumers", () => {
  it("wires hooks, resources, and both middleware kinds by their registration scope", async () => {
    const values: string[] = [];
    const mailer = r
      .resource("mailer")
      .init(async () => "base")
      .build();
    const event = r.event("event").build();
    const hook = r
      .hook("hook")
      .on(event)
      .dependencies({ mailer })
      .run(async (_, deps) => {
        values.push(`hook:${deps.mailer}`);
      })
      .build();
    const taskMiddleware = r.middleware
      .task("taskMiddleware")
      .dependencies({ mailer })
      .run(async ({ next }, deps) => {
        values.push(`task:${deps.mailer}`);
        return next();
      })
      .build();
    const resourceMiddleware = r.middleware
      .resource("resourceMiddleware")
      .dependencies({ mailer })
      .run(async ({ next }, deps) => {
        values.push(`resource:${deps.mailer}`);
        return next();
      })
      .build();
    const read = r
      .task("read")
      .middleware([taskMiddleware])
      .dependencies({ mailer })
      .run(async (_, deps) => deps.mailer)
      .build();
    const service = r
      .resource("service")
      .middleware([resourceMiddleware])
      .dependencies({ mailer })
      .init(async (_, deps) => {
        values.push(`init:${deps.mailer}`);
      })
      .build();
    const b = r
      .resource("b")
      .register([hook, taskMiddleware, resourceMiddleware, read, service])
      .overrides([r.override(mailer, async () => "b")])
      .build();
    const runtime = await run(
      r.resource("app").register([mailer, event, b]).build(),
    );
    try {
      expect(await runtime.runTask(read)).toBe("b");
      await runtime.emitEvent(event);
      expect(values.sort()).toEqual([
        "hook:b",
        "init:b",
        "resource:b",
        "task:b",
      ]);
      const resolved = runtime
        .inspect()
        .explain(read)
        .dependencies.find((dep) => dep.key === "mailer")!;
      expect(runtime.inspect().explain(resolved.id).override).toMatchObject({
        baseCanonicalId: "app.mailer",
        declaredByResourceId: "app.b",
      });
    } finally {
      await runtime.dispose();
    }
  });

  it("does not collapse independent resources with equal local ids", async () => {
    const first = r
      .resource("mailer")
      .init(async () => "first")
      .build();
    const second = r
      .resource("mailer")
      .init(async () => "second")
      .build();
    const read = r
      .task("read")
      .dependencies({ first, second })
      .run(async (_, deps) => deps)
      .build();
    const b = r
      .resource("b")
      .register([read])
      .overrides([r.override(first, async () => "override")])
      .build();
    const app = r
      .resource("app")
      .register([
        r.resource("first").register([first]).build(),
        r.resource("second").register([second]).build(),
        b,
      ])
      .build();
    const runtime = await run(app);
    try {
      expect(await runtime.runTask(read)).toEqual({
        first: "override",
        second: "second",
      });
    } finally {
      await runtime.dispose();
    }
  });
});
