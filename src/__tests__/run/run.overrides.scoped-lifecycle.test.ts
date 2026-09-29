import { r, run } from "../..";

describe("scoped override lifecycle", () => {
  it.each(["sequential", "parallel"] as const)(
    "retains config and independent context in %s lifecycle mode",
    async (lifecycleMode) => {
      const calls: string[] = [];
      const service = r
        .resource<{ prefix: string }>("service")
        .context(() => ({ count: 0 }))
        .init(async (config, _, context) => {
          context.count++;
          return `${config.prefix}:original:${context.count}`;
        })
        .ready(async (value) => {
          calls.push(`ready:${value}`);
        })
        .cooldown(async (value) => {
          calls.push(`cooldown:${value}`);
        })
        .dispose(async (value) => {
          calls.push(`dispose:${value}`);
        })
        .build();
      const readB = r
        .task("readB")
        .dependencies({ service })
        .run(async (_, deps) => deps.service)
        .build();
      const readC = r
        .task("readC")
        .dependencies({ service })
        .run(async (_, deps) => deps.service)
        .build();
      const b = r
        .resource("b")
        .register([readB])
        .overrides([
          r.override(
            service,
            async (config, _, context) =>
              `${config.prefix}:b:${++context.count}`,
          ),
        ])
        .build();
      const c = r
        .resource("c")
        .register([readC])
        .overrides([
          r.override(
            service,
            async (config, _, context) =>
              `${config.prefix}:c:${++context.count}`,
          ),
        ])
        .build();
      const runtime = await run(
        r
          .resource("app")
          .register([service.with({ prefix: "configured" }), b, c])
          .build(),
        { lifecycleMode },
      );
      expect(await runtime.runTask(readB)).toBe("configured:b:1");
      expect(await runtime.runTask(readC)).toBe("configured:c:1");
      await runtime.dispose();
      expect(calls.sort()).toEqual(
        ["ready", "cooldown", "dispose"]
          .flatMap((stage) =>
            ["original", "b", "c"].map(
              (name) => `${stage}:configured:${name}:1`,
            ),
          )
          .sort(),
      );
    },
  );

  it("does not initialize a replaced original and retains child registrations", async () => {
    const original = jest.fn(async () => "original");
    const child = r
      .task("child")
      .run(async () => "child")
      .build();
    const service = r
      .resource("service")
      .register([child])
      .init(original)
      .build();
    const app = r
      .resource("app")
      .register([service])
      .overrides([r.override(service, async () => "replacement")])
      .build();
    const runtime = await run(app);
    try {
      expect(original).not.toHaveBeenCalled();
      expect(runtime.getResourceValue(service)).toBe("replacement");
      expect(await runtime.runTask(child)).toBe("child");
    } finally {
      await runtime.dispose();
    }
  });

  it("keeps startup-unused scoped instances asleep in lazy mode", async () => {
    const init = jest.fn(async () => "scoped");
    const base = r
      .resource("service")
      .init(async () => "original")
      .build();
    const b = r
      .resource("b")
      .overrides([r.override(base, init)])
      .build();
    const runtime = await run(r.resource("app").register([base, b]).build(), {
      lazy: true,
    });
    try {
      expect(init).not.toHaveBeenCalled();
      expect(
        await runtime.getLazyResourceValue(
          "app.b.resources.overrides.app.service",
        ),
      ).toBe("scoped");
      expect(init).toHaveBeenCalledTimes(1);
    } finally {
      await runtime.dispose();
    }
  });
});
