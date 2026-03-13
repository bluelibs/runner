import { asyncContexts, r, run } from "../..";
import { storage } from "../../definers/defineAsyncContext";
import { PlatformAdapter, resetPlatform, setPlatform } from "../../platform";
import {
  tenantContextRequiredError,
  tenantInvalidContextError,
} from "../../errors";

describe("asyncContexts.tenant", () => {
  afterEach(() => {
    resetPlatform();
  });

  it("supports safe probing when no tenant is active", () => {
    expect(asyncContexts.tenant.tryUse()).toBeUndefined();
    expect(asyncContexts.tenant.has()).toBe(false);
  });

  it("stays safely unavailable on platforms without async local storage", () => {
    setPlatform(new PlatformAdapter("universal"));

    expect(asyncContexts.tenant.tryUse()).toBeUndefined();
    expect(asyncContexts.tenant.has()).toBe(false);
    expect(asyncContexts.tenant.provide({ tenantId: "acme" }, () => "ok")).toBe(
      "ok",
    );
  });

  it("throws a typed error when tenant context is required but missing", () => {
    expect(() => asyncContexts.tenant.use()).toThrow();

    try {
      asyncContexts.tenant.use();
    } catch (error) {
      expect(tenantContextRequiredError.is(error)).toBe(true);
    }
  });

  it("rejects invalid tenant payloads", () => {
    expect(() =>
      asyncContexts.tenant.provide({ tenantId: "" }, () => "nope"),
    ).toThrow();

    try {
      asyncContexts.tenant.provide({ tenantId: "" }, () => "nope");
    } catch (error) {
      expect(tenantInvalidContextError.is(error)).toBe(true);
    }
  });

  it("propagates tenant context through task -> event -> hook execution", async () => {
    const seen: string[] = [];

    const tenantObserved = r
      .event<{ tenantId: string }>("tenantObserved")
      .build();

    const emitTenant = r
      .task("emitTenant")
      .middleware([asyncContexts.tenant.require()])
      .dependencies({ tenantObserved })
      .run(async (_input, { tenantObserved }) => {
        const tenantId = asyncContexts.tenant.use().tenantId;
        seen.push(`task:${tenantId}`);
        await tenantObserved({ tenantId });
      })
      .build();

    const recordTenant = r
      .hook("recordTenant")
      .on(tenantObserved)
      .run(async (event) => {
        seen.push(`hook:${asyncContexts.tenant.use().tenantId}`);
        seen.push(`event:${event.data.tenantId}`);
      })
      .build();

    const app = r
      .resource("app")
      .register([tenantObserved, emitTenant, recordTenant])
      .build();

    const runtime = await run(app, { executionContext: true });

    await asyncContexts.tenant.provide({ tenantId: "acme" }, async () => {
      await runtime.runTask(emitTenant);
    });

    expect(seen).toEqual(["task:acme", "hook:acme", "event:acme"]);
    await runtime.dispose();
  });

  it("provides a built-in require() guard", async () => {
    const guardedTask = r
      .task("guardedTask")
      .middleware([asyncContexts.tenant.require()])
      .run(async () => asyncContexts.tenant.use().tenantId)
      .build();

    const app = r.resource("app").register([guardedTask]).build();
    const runtime = await run(app);

    await expect(runtime.runTask(guardedTask)).rejects.toThrow();
    await expect(
      asyncContexts.tenant.provide({ tenantId: "globex" }, async () =>
        runtime.runTask(guardedTask),
      ),
    ).resolves.toBe("globex");

    await runtime.dispose();
  });

  it("restores the outer tenant when tenant providers are nested", async () => {
    const result = await asyncContexts.tenant.provide(
      { tenantId: "outer" },
      async () => {
        const outer = asyncContexts.tenant.use().tenantId;
        const inner = await asyncContexts.tenant.provide(
          { tenantId: "inner" },
          async () => asyncContexts.tenant.use().tenantId,
        );
        const restored = asyncContexts.tenant.use().tenantId;

        return { outer, inner, restored };
      },
    );

    expect(result).toEqual({
      outer: "outer",
      inner: "inner",
      restored: "outer",
    });
  });

  it("has remains a pure probe even when the stored tenant value is invalid", () => {
    const invalidStore = new Map<string, unknown>([
      ["tenant", { tenantId: "" }],
    ]);

    const result = storage.run(invalidStore, () => asyncContexts.tenant.has());

    expect(result).toBe(true);
    expect(() =>
      storage.run(invalidStore, () => asyncContexts.tenant.tryUse()),
    ).toThrow();
  });
});
