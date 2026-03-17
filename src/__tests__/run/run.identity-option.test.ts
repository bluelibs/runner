import { asyncContexts, middleware, r, run } from "../..";
import {
  identityInvalidContextError,
  identityRunOptionRequiresAsyncLocalStorageError,
} from "../../errors";
import { PlatformAdapter, resetPlatform, setPlatform } from "../../platform";

const tenantScope = { tenant: true } as const;

describe("run(..., { identity })", () => {
  afterEach(() => {
    resetPlatform();
  });

  it("falls back to the built-in identity context when no run option is provided", async () => {
    const guarded = r
      .task("tenant-run-option-default-fallback")
      .middleware([
        middleware.task.rateLimit.with({
          windowMs: 5_000,
          max: 1,
          identityScope: tenantScope,
        }),
      ])
      .run(async () => "ok")
      .build();

    const app = r
      .resource("tenant-run-option-default-app")
      .register([guarded])
      .build();
    const runtime = await run(app);

    await expect(runtime.runTask(guarded)).rejects.toThrow();
    await expect(
      asyncContexts.identity.provide({ tenantId: "acme", region: "us" }, () =>
        runtime.runTask(guarded),
      ),
    ).resolves.toBe("ok");

    await runtime.dispose();
  });

  it("uses the configured custom identity context instead of the built-in one", async () => {
    const identity = r
      .asyncContext<{ tenantId: string; userId: string }>(
        "identity-run-option-custom-ctx",
      )
      .configSchema({
        tenantId: String,
        userId: String,
      })
      .build();

    const guarded = r
      .task("identity-run-option-custom-guarded")
      .middleware([
        middleware.task.rateLimit.with({
          windowMs: 5_000,
          max: 1,
          identityScope: tenantScope,
        }),
      ])
      .run(async () => "ok")
      .build();

    const app = r
      .resource("identity-run-option-custom-app")
      .register([identity, guarded])
      .build();
    const runtime = await run(app, { identity });

    await expect(
      asyncContexts.identity.provide({ tenantId: "acme", region: "us" }, () =>
        runtime.runTask(guarded),
      ),
    ).rejects.toThrow();

    await expect(
      identity.provide({ tenantId: "acme", userId: "u1" }, () =>
        runtime.runTask(guarded),
      ),
    ).resolves.toBe("ok");

    await runtime.dispose();
  });

  it("auto-registers the configured identity context so it can be used as a dependency", async () => {
    const identity = r
      .asyncContext<{ tenantId: string }>("identity-run-option-unregistered")
      .configSchema({ tenantId: String })
      .build();
    let seenIdentityId: string | undefined;
    const probe = r
      .resource("identity-run-option-unregistered-probe")
      .dependencies({ identity })
      .init(async (_config, { identity: injectedIdentity }) => {
        seenIdentityId = injectedIdentity.id;
        return "ok";
      })
      .build();
    const app = r
      .resource("identity-run-option-unregistered-app")
      .register([probe])
      .build();

    const runtime = await run(app, { identity });
    expect(seenIdentityId).toBe(identity.id);
    await runtime.dispose();
  });

  it("fails fast on platforms without async local storage when the identity option is used", async () => {
    setPlatform(new PlatformAdapter("browser"));

    const identity = r
      .asyncContext<{ tenantId: string }>("identity-run-option-browser")
      .configSchema({ tenantId: String })
      .build();
    const app = r
      .resource("identity-run-option-browser-app")
      .register([identity])
      .build();

    await expect(run(app, { identity })).rejects.toThrow(
      /requires AsyncLocalStorage/i,
    );

    try {
      await run(app, { identity });
    } catch (error) {
      expect(identityRunOptionRequiresAsyncLocalStorageError.is(error)).toBe(
        true,
      );
    }
  });

  it("keeps identity readers isolated per runtime when multiple runtimes use different contexts", async () => {
    const identityA = r
      .asyncContext<{ tenantId: string }>("identity-run-option-isolated-a")
      .configSchema({ tenantId: String })
      .build();
    const identityB = r
      .asyncContext<{ tenantId: string }>("identity-run-option-isolated-b")
      .configSchema({ tenantId: String })
      .build();

    const guarded = r
      .task("identity-run-option-isolated-task")
      .middleware([
        middleware.task.rateLimit.with({
          windowMs: 5_000,
          max: 1,
          identityScope: tenantScope,
        }),
      ])
      .run(async () => "ok")
      .build();

    const appA = r
      .resource("identity-run-option-isolated-app-a")
      .register([identityA, guarded])
      .build();
    const appB = r
      .resource("identity-run-option-isolated-app-b")
      .register([identityB, guarded])
      .build();

    const runtimeA = await run(appA, { identity: identityA });
    const runtimeB = await run(appB, { identity: identityB });

    await expect(
      Promise.all([
        identityA.provide({ tenantId: "acme" }, () =>
          runtimeA.runTask(guarded),
        ),
        identityB.provide({ tenantId: "globex" }, () =>
          runtimeB.runTask(guarded),
        ),
      ]),
    ).resolves.toEqual(["ok", "ok"]);

    await runtimeA.dispose();
    await runtimeB.dispose();
  });

  it("still validates tenantId at middleware read time for custom contexts", async () => {
    const identity = r
      .asyncContext<{ tenantId: string }>("identity-run-option-invalid-payload")
      .build();
    const guarded = r
      .task("identity-run-option-invalid-task")
      .middleware([
        middleware.task.rateLimit.with({
          windowMs: 5_000,
          max: 1,
          identityScope: tenantScope,
        }),
      ])
      .run(async () => "ok")
      .build();

    const app = r
      .resource("identity-run-option-invalid-app")
      .register([identity, guarded])
      .build();
    const runtime = await run(app, { identity });

    await expect(
      identity.provide({ tenantId: "" } as { tenantId: string }, () =>
        runtime.runTask(guarded),
      ),
    ).rejects.toThrow();

    try {
      await identity.provide({ tenantId: "" } as { tenantId: string }, () =>
        runtime.runTask(guarded),
      );
    } catch (error) {
      expect(identityInvalidContextError.is(error)).toBe(true);
    }

    await runtime.dispose();
  });
});
