import { asyncContexts, r, run } from "../..";
import { storage } from "../../definers/defineAsyncContext";
import {
  PlatformAdapter,
  getPlatform,
  resetPlatform,
  setPlatform,
} from "../../platform";
import {
  identityContextRequiredError,
  identityInvalidContextError,
} from "../../errors";

function tenantValue(tenantId: string) {
  return {
    tenantId,
    region: `${tenantId}-region`,
  };
}

describe("asyncContexts.identity", () => {
  const globalScope = globalThis as typeof globalThis & {
    AsyncLocalStorage?: new <T>() => {
      getStore(): T | undefined;
      run<R>(store: T, callback: () => R): R;
    };
  };
  const originalAsyncLocalStorage = globalScope.AsyncLocalStorage;

  afterEach(() => {
    globalScope.AsyncLocalStorage = originalAsyncLocalStorage;
    jest.restoreAllMocks();
    resetPlatform();
  });

  it("supports safe probing when no identity is active", () => {
    expect(asyncContexts.identity.tryUse()).toBeUndefined();
    expect(asyncContexts.identity.has()).toBe(false);
  });

  it("exposes an optional dependency wrapper", () => {
    const optionalIdentity = asyncContexts.identity.optional();
    expect(optionalIdentity.inner).toBe(asyncContexts.identity);
  });

  it("stays safely unavailable on platforms without async local storage", () => {
    jest.spyOn(process, "getBuiltinModule").mockReturnValue(undefined);
    globalScope.AsyncLocalStorage = undefined;
    setPlatform(new PlatformAdapter("universal"));

    expect(asyncContexts.identity.tryUse()).toBeUndefined();
    expect(asyncContexts.identity.has()).toBe(false);
    expect(
      asyncContexts.identity.provide(tenantValue("acme"), () => "ok"),
    ).toBe("ok");
  });

  it("throws a typed error when identity context is required but missing", () => {
    expect(() => asyncContexts.identity.use()).toThrow();

    try {
      asyncContexts.identity.use();
    } catch (error) {
      expect(identityContextRequiredError.is(error)).toBe(true);
    }
  });

  it("exposes optional() for dependency wiring", () => {
    const optionalIdentity = asyncContexts.identity.optional();

    expect(optionalIdentity.inner).toBe(asyncContexts.identity);
  });

  it("rejects invalid built-in identity payloads", () => {
    expect(() =>
      asyncContexts.identity.provide(tenantValue(""), () => "nope"),
    ).toThrow();
    expect(() =>
      asyncContexts.identity.provide(tenantValue("acme:west"), () => "nope"),
    ).toThrow(/cannot contain ":"/);
    expect(() =>
      asyncContexts.identity.provide(tenantValue("__global__"), () => "nope"),
    ).toThrow(/reserved for the shared non-identity namespace/);
    expect(() =>
      asyncContexts.identity.provide(
        { tenantId: "acme", region: "eu-west", roles: ["ADMIN", ""] },
        () => "nope",
      ),
    ).toThrow();

    try {
      asyncContexts.identity.provide(tenantValue(""), () => "nope");
    } catch (error) {
      expect(identityInvalidContextError.is(error)).toBe(true);
    }

    try {
      asyncContexts.identity.provide(tenantValue("acme:west"), () => "nope");
    } catch (error) {
      expect(identityInvalidContextError.is(error)).toBe(true);
    }

    try {
      asyncContexts.identity.provide(tenantValue("__global__"), () => "nope");
    } catch (error) {
      expect(identityInvalidContextError.is(error)).toBe(true);
    }

    try {
      asyncContexts.identity.provide(
        { tenantId: "acme", region: "eu-west", roles: ["ADMIN", ""] },
        () => "nope",
      );
    } catch (error) {
      expect(identityInvalidContextError.is(error)).toBe(true);
    }
  });

  it("preserves roles on the built-in identity payload", async () => {
    const result = await asyncContexts.identity.provide(
      { tenantId: "acme", region: "eu-west", userId: "u1", roles: ["ADMIN"] },
      async () => asyncContexts.identity.use(),
    );

    expect(result.roles).toEqual(["ADMIN"]);
  });

  it("propagates identity context through task -> event -> hook execution", async () => {
    const seen: string[] = [];

    const tenantObserved = r
      .event<{ tenantId: string }>("tenantObserved")
      .build();

    const emitTenant = r
      .task("emitTenant")
      .middleware([asyncContexts.identity.require()])
      .dependencies({ tenantObserved })
      .run(async (_input, { tenantObserved }) => {
        const tenantId = asyncContexts.identity.use().tenantId!;
        seen.push(`task:${tenantId}`);
        await tenantObserved({ tenantId });
      })
      .build();

    const recordTenant = r
      .hook("recordTenant")
      .on(tenantObserved)
      .run(async (event) => {
        seen.push(`hook:${asyncContexts.identity.use().tenantId}`);
        seen.push(`event:${event.data.tenantId}`);
      })
      .build();

    const app = r
      .resource("app")
      .register([tenantObserved, emitTenant, recordTenant])
      .build();

    const runtime = await run(app, { executionContext: true });

    await asyncContexts.identity.provide(tenantValue("acme"), async () => {
      await runtime.runTask(emitTenant);
    });

    expect(seen).toEqual(["task:acme", "hook:acme", "event:acme"]);
    await runtime.dispose();
  });

  it("provides a built-in require() guard", async () => {
    const guardedTask = r
      .task("guardedTask")
      .middleware([asyncContexts.identity.require()])
      .run(async () => asyncContexts.identity.use().tenantId)
      .build();

    const app = r.resource("app").register([guardedTask]).build();
    const runtime = await run(app);

    await expect(runtime.runTask(guardedTask)).rejects.toThrow();
    await expect(
      asyncContexts.identity.provide(tenantValue("globex"), async () =>
        runtime.runTask(guardedTask),
      ),
    ).resolves.toBe("globex");

    await runtime.dispose();
  });

  it("restores the outer identity when identity providers are nested", async () => {
    const result = await asyncContexts.identity.provide(
      tenantValue("outer"),
      async () => {
        const outer = asyncContexts.identity.use().tenantId;
        const inner = await asyncContexts.identity.provide(
          tenantValue("inner"),
          async () => asyncContexts.identity.use().tenantId,
        );
        const restored = asyncContexts.identity.use().tenantId;

        return { outer, inner, restored };
      },
    );

    expect(result).toEqual({
      outer: "outer",
      inner: "inner",
      restored: "outer",
    });
  });

  it("has remains a pure probe even when the stored identity value is invalid", () => {
    const invalidStore = new Map<string, unknown>([
      ["identity", { tenantId: "" }],
    ]);

    const result = storage.run(invalidStore, () =>
      asyncContexts.identity.has(),
    );

    expect(result).toBe(true);
    expect(() =>
      storage.run(invalidStore, () => asyncContexts.identity.tryUse()),
    ).toThrow();
  });

  it("rechecks async-local availability after platform init", async () => {
    globalScope.AsyncLocalStorage = class MockALS<T> {
      private store: T | undefined;

      getStore(): T | undefined {
        return this.store;
      }

      run<R>(store: T, callback: () => R): R {
        const previous = this.store;
        this.store = store;
        try {
          return callback();
        } finally {
          this.store = previous;
        }
      }
    };

    setPlatform(new PlatformAdapter("universal"));
    expect(
      asyncContexts.identity.provide(tenantValue("acme"), () => "before"),
    ).toBe("before");

    await getPlatform().init();

    const result = await asyncContexts.identity.provide(
      tenantValue("acme"),
      async () => asyncContexts.identity.use().tenantId,
    );

    expect(result).toBe("acme");
  });
});
