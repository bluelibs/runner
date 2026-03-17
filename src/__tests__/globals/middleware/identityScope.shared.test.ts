import { asyncContexts } from "../../../";
import { identityInvalidContextError } from "../../../errors";
import {
  applyIdentityScopeToKey,
  normalizeIdentityScopeConfig,
  resolveIdentityContext,
} from "../../../globals/middleware/identityScope.shared";
import { concurrencyTaskMiddleware } from "../../../globals/middleware/concurrency.middleware";

const tenantScope = { tenant: true } as const;
const optionalTenantScope = { required: false, tenant: true } as const;
const userScope = { tenant: true, user: true } as const;
const optionalUserScope = {
  required: false,
  tenant: true,
  user: true,
} as const;
const tenantValue = (tenantId: string, userId?: string) => ({
  tenantId,
  region: `${tenantId}-region`,
  ...(userId === undefined ? {} : { userId }),
});

describe("identityScope shared helpers", () => {
  it("normalizes object config defaults", () => {
    expect(normalizeIdentityScopeConfig(undefined)).toBeUndefined();
    expect(normalizeIdentityScopeConfig({ tenant: true })).toEqual({
      required: true,
      tenant: true,
      user: false,
    });
    expect(
      normalizeIdentityScopeConfig({
        required: false,
        tenant: true,
        user: true,
      }),
    ).toEqual({
      required: false,
      tenant: true,
      user: true,
    });
  });

  it("rejects invalid identityScope values at config time", () => {
    expect(() =>
      concurrencyTaskMiddleware.with({
        limit: 1,
        identityScope: "required" as never,
      }),
    ).toThrow();
    expect(() =>
      concurrencyTaskMiddleware.with({
        limit: 1,
        identityScope: { required: false } as never,
      }),
    ).toThrow();
    expect(() =>
      concurrencyTaskMiddleware.with({
        limit: 1,
        identityScope: { tenant: true, bogus: true } as never,
      }),
    ).toThrow();
    expect(() =>
      concurrencyTaskMiddleware.with({
        limit: 1,
        identityScope: { tenant: true, required: "yes" } as never,
      }),
    ).toThrow();
  });

  it("supports explicit helper resolution paths without mutating global identity state", () => {
    expect(
      resolveIdentityContext(undefined, () => tenantValue("ignored")),
    ).toBeUndefined();
    expect(
      resolveIdentityContext(optionalTenantScope, () => null),
    ).toBeUndefined();
    expect(
      resolveIdentityContext(optionalTenantScope, () => ({ userId: "u1" })),
    ).toBeUndefined();
    expect(() =>
      resolveIdentityContext(tenantScope, () => ({ userId: "u1" })),
    ).toThrow();
    expect(
      applyIdentityScopeToKey("search", optionalTenantScope, () => null),
    ).toBe("search");
    expect(
      applyIdentityScopeToKey("search", tenantScope, () => tenantValue("acme")),
    ).toBe("acme:search");
    expect(
      applyIdentityScopeToKey("search", tenantScope, () => ({
        tenantId: "acme",
        userId: "",
      })),
    ).toBe("acme:search");
    expect(
      applyIdentityScopeToKey("search", optionalUserScope, () =>
        tenantValue("acme", "u1"),
      ),
    ).toBe("acme:u1:search");
    expect(
      applyIdentityScopeToKey("search", optionalUserScope, () =>
        tenantValue("acme"),
      ),
    ).toBe("acme:search");
    expect(
      applyIdentityScopeToKey("search", userScope, () =>
        tenantValue("acme", "u1"),
      ),
    ).toBe("acme:u1:search");
    expect(() =>
      applyIdentityScopeToKey("search", userScope, () => tenantValue("acme")),
    ).toThrow(/userId/i);
  });

  it("uses the built-in identity reader when no explicit reader is provided", async () => {
    await asyncContexts.identity.provide(tenantValue("acme"), async () => {
      expect(resolveIdentityContext(tenantScope)).toEqual(tenantValue("acme"));
      expect(applyIdentityScopeToKey("search", tenantScope)).toBe(
        "acme:search",
      );
    });
  });

  it("treats identity without tenantId as absent unless the scope is required", () => {
    expect(
      resolveIdentityContext(optionalTenantScope, () => ({ userId: "u1" })),
    ).toBeUndefined();
    expect(() =>
      resolveIdentityContext(tenantScope, () => ({ userId: "u1" })),
    ).toThrow(/Identity context is required/);
  });

  it("fails fast on invalid identity payloads when resolving identity scope", () => {
    expect(() =>
      resolveIdentityContext(optionalTenantScope, () => tenantValue("")),
    ).toThrow();
    expect(() =>
      resolveIdentityContext(optionalTenantScope, () =>
        tenantValue("acme:west"),
      ),
    ).toThrow(/cannot contain ":"/);
    expect(() =>
      resolveIdentityContext(optionalTenantScope, () =>
        tenantValue("__global__"),
      ),
    ).toThrow(/reserved for the shared non-identity namespace/);

    try {
      resolveIdentityContext(optionalTenantScope, () => tenantValue(""));
    } catch (error) {
      expect(identityInvalidContextError.is(error)).toBe(true);
    }

    expect(() =>
      applyIdentityScopeToKey("search", optionalUserScope, () =>
        tenantValue("acme", "u:1"),
      ),
    ).toThrow(/cannot contain ":"/);
    expect(() =>
      applyIdentityScopeToKey("search", optionalUserScope, () =>
        tenantValue("acme", ""),
      ),
    ).toThrow(/userId.*non-empty string/i);
  });
});
