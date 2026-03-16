import { r, run } from "../..";
import { override } from "../../definers/builders/override";

describe("r.override shorthand", () => {
  it("throws when implementation function is missing", () => {
    const baseTask = r
      .task("tests-override-shorthand-missing-implementation")
      .run(async () => 1)
      .build();

    const runtimeOverride = override as unknown as (
      base: unknown,
      fn?: unknown,
    ) => unknown;
    expect(() => runtimeOverride(baseTask)).toThrow(
      /requires an implementation function/,
    );
  });

  it("throws when implementation is not a function", () => {
    const baseTask = r
      .task("tests-override-shorthand-invalid-implementation")
      .run(async () => 1)
      .build();

    const runtimeOverride = override as unknown as (
      base: unknown,
      fn?: unknown,
    ) => unknown;
    expect(() => runtimeOverride(baseTask, "not-a-function")).toThrow(
      /second argument must be a function/,
    );
  });

  it("can register a shorthand-overridden resource directly without using .overrides()", async () => {
    const suffixTask = r
      .task("tests-override-shorthand-resource-direct-register-suffix")
      .run(async () => "-suffix")
      .build();

    const baseMailerResource = r
      .resource<{
        prefix: string;
      }>("tests-override-shorthand-resource-direct-register-mailer")
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
      .resource("tests-override-shorthand-resource-direct-register-app")
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
      .task("tests-override-shorthand-task")
      .run(async () => 1)
      .build();

    const taskOverride = r.override(baseTask, async () => 2);

    const app = r
      .resource("tests-override-shorthand-task-app")
      .register([baseTask])
      .overrides([taskOverride])
      .build();

    const runtime = await run(app);
    await expect(runtime.runTask(baseTask)).resolves.toBe(2);
    await runtime.dispose();
  });

  it("overrides resource init with r.override(resource, initFn)", async () => {
    const baseResource = r
      .resource("tests-override-shorthand-resource")
      .init(async () => "base")
      .build();

    const resourceOverride = r.override(baseResource, async () => "override");

    const app = r
      .resource("tests-override-shorthand-resource-app")
      .register([baseResource])
      .overrides([resourceOverride])
      .build();

    const runtime = await run(app);
    expect(runtime.getResourceValue(baseResource)).toBe("override");
    await runtime.dispose();
  });

  it("overrides resource lifecycle with object form", async () => {
    const calls: string[] = [];
    const baseResource = r
      .resource<{ mode: string }>(
        "tests-override-shorthand-resource-object-form",
      )
      .context(() => ({ marker: "base", disposed: false }))
      .init(async (config, _deps, context) => {
        calls.push(`base-init:${config.mode}:${context.marker}`);
        return "base";
      })
      .ready(async (value, _config, _deps, context) => {
        calls.push(`base-ready:${value}:${context.marker}`);
      })
      .dispose(async (_value, _config, _deps, context) => {
        calls.push(`base-dispose:${context.marker}`);
        context.disposed = true;
      })
      .build();

    const resourceOverride = r.override(baseResource, {
      context: () => ({ marker: "override", disposed: false }),
      init: async (config, _deps, context) => {
        calls.push(`override-init:${config.mode}:${context.marker}`);
        return "override";
      },
      ready: async (value, _config, _deps, context) => {
        calls.push(`override-ready:${value}:${context.marker}`);
      },
      cooldown: async (_value, _config, _deps, context) => {
        calls.push(`override-cooldown:${context.marker}`);
      },
      dispose: async (_value, _config, _deps, context) => {
        context.disposed = true;
        calls.push(`override-dispose:${context.marker}:${context.disposed}`);
      },
    });

    const app = r
      .resource("tests-override-shorthand-resource-object-form-app")
      .register([resourceOverride.with({ mode: "patched" })])
      .dependencies({ baseResource })
      .init(async (_config, { baseResource }) => baseResource)
      .build();

    const runtime = await run(app);
    expect(runtime.value).toBe("override");

    await runtime.dispose();

    expect(calls).toEqual([
      "override-init:patched:override",
      "override-ready:override:override",
      "override-cooldown:override",
      "override-dispose:override:true",
    ]);
  });

  it("inherits unspecified resource lifecycle hooks in object form", async () => {
    const calls: string[] = [];
    const baseResource = r
      .resource("tests-override-shorthand-resource-object-inherit")
      .context(() => ({ disposed: false }))
      .init(async () => "base")
      .ready(async (value) => {
        calls.push(`base-ready:${value}`);
      })
      .dispose(async (_value, _config, _deps, context) => {
        context.disposed = true;
        calls.push(`base-dispose:${context.disposed}`);
      })
      .build();

    const resourceOverride = r.override(baseResource, {
      init: async () => "override",
    });

    const app = r
      .resource("tests-override-shorthand-resource-object-inherit-app")
      .register([baseResource])
      .overrides([resourceOverride])
      .dependencies({ baseResource })
      .init(async (_config, { baseResource }) => baseResource)
      .build();

    const runtime = await run(app);
    expect(runtime.value).toBe("override");

    await runtime.dispose();

    expect(calls).toEqual(["base-ready:override", "base-dispose:true"]);
  });

  it("can add dispose/ready/cooldown stages through resource object form", async () => {
    const calls: string[] = [];
    const baseResource = r
      .resource("tests-override-shorthand-resource-object-add-stages")
      .context(() => ({ cooled: false }))
      .init(async () => "base")
      .build();

    const resourceOverride = r.override(baseResource, {
      ready: async (value) => {
        calls.push(`ready:${value}`);
      },
      cooldown: async (_value, _config, _deps, context) => {
        context.cooled = true;
        calls.push(`cooldown:${context.cooled}`);
      },
      dispose: async (_value, _config, _deps, context) => {
        calls.push(`dispose:${context.cooled}`);
      },
    });

    const app = r
      .resource("tests-override-shorthand-resource-object-add-stages-app")
      .register([baseResource])
      .overrides([resourceOverride])
      .build();

    const runtime = await run(app);
    await runtime.dispose();

    expect(calls).toEqual(["ready:base", "cooldown:true", "dispose:true"]);
  });

  it("can register a resource object-form override directly without using .overrides()", async () => {
    const calls: string[] = [];
    const baseResource = r
      .resource("tests-override-shorthand-resource-object-direct-register")
      .context(() => ({ disposed: false }))
      .init(async () => "base")
      .build();

    const directOverride = r.override(baseResource, {
      init: async () => "override",
      dispose: async (_value, _config, _deps, context) => {
        context.disposed = true;
        calls.push(`dispose:${context.disposed}`);
      },
    });

    const app = r
      .resource("tests-override-shorthand-resource-object-direct-register-app")
      .register([directOverride])
      .dependencies({ baseResource })
      .init(async (_config, { baseResource }) => baseResource)
      .build();

    const runtime = await run(app);
    expect(runtime.value).toBe("override");
    await runtime.dispose();

    expect(calls).toEqual(["dispose:true"]);
  });

  it("overrides hook run with r.override(hook, runFn)", async () => {
    const userCreated = r.event("tests-override-shorthand-hook-event").build();
    let marker = "base";

    const baseHook = r
      .hook("tests-override-shorthand-hook")
      .on(userCreated)
      .run(async () => {
        marker = "base";
      })
      .build();

    const hookOverride = r.override(baseHook, async () => {
      marker = "override";
    });

    const app = r
      .resource("tests-override-shorthand-hook-app")
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
      .task("tests-override-shorthand-middleware-task")
      .run(async ({ next }) => `base:${await next()}`)
      .build();

    const middlewareOverride = r.override(baseMiddleware, async ({ next }) => {
      return `override:${await next()}`;
    });

    const baseTask = r
      .task("tests-override-shorthand-middleware-task-target")
      .middleware([baseMiddleware])
      .run(async () => "ok")
      .build();

    const app = r
      .resource("tests-override-shorthand-middleware-task-app")
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
      .resource("tests-override-shorthand-middleware-resource")
      .run(async ({ next }) => `base:${await next()}`)
      .build();

    const middlewareOverride = r.override(baseMiddleware, async ({ next }) => {
      return `override:${await next()}`;
    });

    const baseResource = r
      .resource("tests-override-shorthand-middleware-resource-target")
      .middleware([baseMiddleware])
      .init(async () => "ok")
      .build();

    const app = r
      .resource("tests-override-shorthand-middleware-resource-app")
      .register([baseMiddleware, baseResource])
      .overrides([middlewareOverride])
      .dependencies({ baseResource })
      .init(async (_config, { baseResource }) => baseResource)
      .build();

    const runtime = await run(app);
    expect(runtime.value).toBe("override:ok");
    await runtime.dispose();
  });

  it("throws when fn shorthand is provided with an unrecognized base type", () => {
    // Bypass the type system to pass an object that doesn't match any known type.
    // This exercises the isResourceMiddleware(base) false branch within the fn block.
    const unknownBase = { id: "unknown", __type: "alien" } as any;
    expect(() => override(unknownBase, async () => "noop")).toThrow(/override/);
  });

  it("rejects object-form overrides for non-resource bases", () => {
    const baseTask = r
      .task("tests-override-shorthand-non-resource-object-form")
      .run(async () => 1)
      .build();

    const runtimeOverride = override as unknown as (
      base: unknown,
      fn?: unknown,
    ) => unknown;
    expect(() =>
      runtimeOverride(baseTask, {
        run: async () => 2,
      }),
    ).toThrow(
      /resource patch objects are supported only when the base is a resource/,
    );
  });

  it("rejects empty resource patch objects", () => {
    const baseResource = r
      .resource("tests-override-shorthand-resource-empty-patch")
      .init(async () => "base")
      .build();

    const runtimeOverride = override as unknown as (
      base: unknown,
      fn?: unknown,
    ) => unknown;
    expect(() => runtimeOverride(baseResource, {})).toThrow(
      /must include at least one of/,
    );
  });

  it("rejects unsupported resource patch keys", () => {
    const baseResource = r
      .resource("tests-override-shorthand-resource-unsupported-patch-key")
      .init(async () => "base")
      .build();

    const runtimeOverride = override as unknown as (
      base: unknown,
      fn?: unknown,
    ) => unknown;
    expect(() =>
      runtimeOverride(baseResource, {
        health: async () => ({ status: "healthy" }),
      }),
    ).toThrow(/unsupported key "health"/);
  });

  it("rejects non-function resource patch values", () => {
    const baseResource = r
      .resource("tests-override-shorthand-resource-invalid-patch-value")
      .init(async () => "base")
      .build();

    const runtimeOverride = override as unknown as (
      base: unknown,
      fn?: unknown,
    ) => unknown;
    expect(() =>
      runtimeOverride(baseResource, {
        dispose: "later",
      }),
    ).toThrow(/resource patch key "dispose" must be a function/);
  });

  it("rejects non-object non-function resource override implementations", () => {
    const baseResource = r
      .resource("tests-override-shorthand-resource-invalid-implementation")
      .init(async () => "base")
      .build();

    const runtimeOverride = override as unknown as (
      base: unknown,
      fn?: unknown,
    ) => unknown;
    expect(() => runtimeOverride(baseResource, "later")).toThrow(
      /second argument must be a function/,
    );
  });
});
