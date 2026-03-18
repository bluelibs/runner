import {
  assertIdentityRequirement,
  cloneIdentityRequirementConfig,
  identityRequirementPattern,
  isIdentityRequirementConfig,
  normalizeIdentityRequirementConfig,
} from "../../../globals/middleware/identityRequirement.shared";
import {
  identityAuthorizationError,
  identityContextRequiredError,
  identityInvalidContextError,
} from "../../../errors";
import { Match } from "../../../tools/check";

describe("identityRequirement.shared", () => {
  it("validates public identity requirement configs", () => {
    expect(isIdentityRequirementConfig({})).toBe(true);
    expect(isIdentityRequirementConfig({ user: true, roles: ["ADMIN"] })).toBe(
      true,
    );
    expect(isIdentityRequirementConfig([])).toBe(false);
    expect(isIdentityRequirementConfig({ tenant: false })).toBe(false);
    expect(isIdentityRequirementConfig({ roles: [1] })).toBe(false);
    expect(isIdentityRequirementConfig({ other: true })).toBe(false);
    expect(Match.test({ roles: ["ADMIN"] }, identityRequirementPattern)).toBe(
      true,
    );
  });

  it("clones and normalizes identity requirement configs", () => {
    const roles = ["ADMIN"];
    const cloned = cloneIdentityRequirementConfig({ roles });
    const clonedWithoutRoles = cloneIdentityRequirementConfig({ user: true });
    const normalized = normalizeIdentityRequirementConfig({
      user: true,
      roles,
    });

    expect(cloned).toEqual({ roles: ["ADMIN"] });
    expect(cloned.roles).not.toBe(roles);
    expect(clonedWithoutRoles).toEqual({ user: true });
    expect(normalized).toEqual({
      tenant: true,
      user: true,
      roles: ["ADMIN"],
    });
    expect(normalizeIdentityRequirementConfig(undefined)).toBeUndefined();
  });

  it("returns undefined when no identity requirement is configured", () => {
    expect(
      assertIdentityRequirement(undefined, () => undefined),
    ).toBeUndefined();
  });

  it("fails fast when required identity is missing", () => {
    expect(() => assertIdentityRequirement({})).toThrow(
      /Identity context is required/i,
    );

    try {
      assertIdentityRequirement({});
    } catch (error) {
      expect(identityContextRequiredError.is(error)).toBe(true);
    }
  });

  it("rejects invalid tenant and user fields from custom identity readers", () => {
    expect(() =>
      assertIdentityRequirement({}, () => ({ tenantId: "__global__" })),
    ).toThrow(/reserved for the shared non-identity namespace/i);
    expect(() =>
      assertIdentityRequirement({ user: true }, () => ({
        tenantId: "acme",
        userId: "user:1",
      })),
    ).toThrow(/cannot contain/i);
  });

  it("rejects invalid roles and authorization mismatches", () => {
    expect(() =>
      assertIdentityRequirement({ roles: ["ADMIN"] }, () => ({
        tenantId: "acme",
        roles: [1],
      })),
    ).toThrow(/roles/i);

    let authorizationError: unknown;
    try {
      assertIdentityRequirement({ roles: ["ADMIN"] }, () => ({
        tenantId: "acme",
        roles: ["CUSTOMER"],
      }));
    } catch (error) {
      authorizationError = error;
    }

    expect(identityAuthorizationError.is(authorizationError)).toBe(true);
  });

  it("returns the validated identity when the requirement passes", () => {
    const result = assertIdentityRequirement(
      { user: true, roles: ["ADMIN"] },
      () => ({
        tenantId: "acme",
        userId: "u1",
        roles: ["ADMIN"],
        region: "eu-west",
      }),
    );

    expect(result).toEqual({
      tenantId: "acme",
      userId: "u1",
      roles: ["ADMIN"],
      region: "eu-west",
    });
  });

  it("formats authorization errors with and without required roles", () => {
    expect(
      identityAuthorizationError.new({ requiredRoles: ["ADMIN"] }).message,
    ).toMatch(/ADMIN/);
    expect(identityAuthorizationError.new({}).message).toMatch(
      /authorization policy/i,
    );
    expect(identityInvalidContextError.is(new Error("nope"))).toBe(false);
  });
});
