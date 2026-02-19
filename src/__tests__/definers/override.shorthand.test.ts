import { r, run } from "../..";

describe("r.override shorthand", () => {
  it("can register a shorthand-overridden resource directly without using .overrides()", async () => {
    const suffixTask = r
      .task("tests.override.shorthand.resource.direct-register.suffix")
      .run(async () => "-suffix")
      .build();

    const baseMailerResource = r
      .resource<{
        prefix: string;
      }>("tests.override.shorthand.resource.direct-register.mailer")
      .dependencies({ suffixTask })
      .context(() => ({ calls: 0 }))
      .init(async (config, { suffixTask }, ctx) => {
        ctx.calls += 1;
        return `${config.prefix}${await suffixTask()}`;
      })
      .build();

    const customMailer = r.override(
      baseMailerResource,
      async (config, { suffixTask }, ctx) => {
        ctx.calls += 1;
        return `custom:${config.prefix}${await suffixTask()}`;
      },
    );

    const app = r
      .resource("tests.override.shorthand.resource.direct-register.app")
      .register([suffixTask, customMailer.with({ prefix: "mail" })])
      .dependencies({ baseMailerResource })
      .init(async (_config, { baseMailerResource }) => baseMailerResource)
      .build();

    const runtime = await run(app);
    expect(runtime.value).toBe("custom:mail-suffix");
    await runtime.dispose();
  });

  it("overrides task run with r.override(task, runFn)", async () => {
    const baseTask = r
      .task("tests.override.shorthand.task")
      .run(async () => 1)
      .build();

    const taskOverride = r.override(baseTask, async () => 2);

    const app = r
      .resource("tests.override.shorthand.task.app")
      .register([baseTask])
      .overrides([taskOverride])
      .build();

    const runtime = await run(app);
    await expect(runtime.runTask(baseTask.id)).resolves.toBe(2);
    await runtime.dispose();
  });

  it("overrides resource init with r.override(resource, initFn)", async () => {
    const baseResource = r
      .resource("tests.override.shorthand.resource")
      .init(async () => "base")
      .build();

    const resourceOverride = r.override(baseResource, async () => "override");

    const app = r
      .resource("tests.override.shorthand.resource.app")
      .register([baseResource])
      .overrides([resourceOverride])
      .build();

    const runtime = await run(app);
    expect(runtime.getResourceValue(baseResource)).toBe("override");
    await runtime.dispose();
  });

  it("overrides hook run with r.override(hook, runFn)", async () => {
    const userCreated = r.event("tests.override.shorthand.hook.event").build();
    let marker = "base";

    const baseHook = r
      .hook("tests.override.shorthand.hook")
      .on(userCreated)
      .run(async () => {
        marker = "base";
      })
      .build();

    const hookOverride = r.override(baseHook, async () => {
      marker = "override";
    });

    const app = r
      .resource("tests.override.shorthand.hook.app")
      .register([userCreated, baseHook])
      .overrides([hookOverride])
      .dependencies({ userCreated })
      .init(async (_config, { userCreated }) => {
        await userCreated({});
        return marker;
      })
      .build();

    const runtime = await run(app);
    expect(runtime.value).toBe("override");
    await runtime.dispose();
  });

  it("overrides task middleware run with r.override(mw, runFn)", async () => {
    const baseMiddleware = r.middleware
      .task("tests.override.shorthand.middleware.task")
      .run(async ({ next }) => `base:${await next()}`)
      .build();

    const middlewareOverride = r.override(baseMiddleware, async ({ next }) => {
      return `override:${await next()}`;
    });

    const baseTask = r
      .task("tests.override.shorthand.middleware.task.target")
      .middleware([baseMiddleware])
      .run(async () => "ok")
      .build();

    const app = r
      .resource("tests.override.shorthand.middleware.task.app")
      .register([baseMiddleware, baseTask])
      .overrides([middlewareOverride])
      .dependencies({ baseTask })
      .init(async (_config, { baseTask }) => baseTask())
      .build();

    const runtime = await run(app);
    expect(runtime.value).toBe("override:ok");
    await runtime.dispose();
  });

  it("overrides resource middleware run with r.override(mw, runFn)", async () => {
    const baseMiddleware = r.middleware
      .resource("tests.override.shorthand.middleware.resource")
      .run(async ({ next }) => `base:${await next()}`)
      .build();

    const middlewareOverride = r.override(baseMiddleware, async ({ next }) => {
      return `override:${await next()}`;
    });

    const baseResource = r
      .resource("tests.override.shorthand.middleware.resource.target")
      .middleware([baseMiddleware])
      .init(async () => "ok")
      .build();

    const app = r
      .resource("tests.override.shorthand.middleware.resource.app")
      .register([baseMiddleware, baseResource])
      .overrides([middlewareOverride])
      .dependencies({ baseResource })
      .init(async (_config, { baseResource }) => baseResource)
      .build();

    const runtime = await run(app);
    expect(runtime.value).toBe("override:ok");
    await runtime.dispose();
  });
});
