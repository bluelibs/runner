import { identityContextResource } from "../../../globals/resources/identityContext.resource";
import { identityRunOptionContextNotRegisteredError } from "../../../errors";
import type { IdentityAsyncContext } from "../../../types/runner";

function createTenantContext(
  overrides: Partial<Pick<IdentityAsyncContext, "tryUse">> = {},
): IdentityAsyncContext {
  return {
    id: "tenant-resource-test-context",
    use: () => ({ tenantId: "acme" }),
    tryUse: () => ({ tenantId: "acme" }),
    has: () => true,
    provide: <R>(_value: unknown, fn: () => Promise<R> | R) => fn(),
    require: () => ({}) as any,
    ...overrides,
  } as unknown as IdentityAsyncContext;
}

describe("identityContextResource", () => {
  it("rejects invalid context shapes in configSchema", () => {
    expect(() =>
      identityContextResource.configSchema?.parse({ context: null }),
    ).toThrow();

    expect(() =>
      identityContextResource.configSchema?.parse({
        context: { id: "missing-methods" },
      }),
    ).toThrow();
  });

  it("returns undefined for missing identity state and passes through present values", async () => {
    const missing = await identityContextResource.init?.(
      {
        context: createTenantContext({ tryUse: () => undefined }),
      },
      {} as never,
      {} as never,
    );
    expect(missing?.tryUse()).toBeUndefined();

    const present = await identityContextResource.init?.(
      {
        context: createTenantContext({
          tryUse: () => ({ tenantId: "globex", userId: "u1" }),
        }),
      },
      {} as never,
      {} as never,
    );

    expect(present?.tryUse()).toEqual({ tenantId: "globex", userId: "u1" });
  });

  it("formats the identity run-option registration error for diagnostics", () => {
    const error = identityRunOptionContextNotRegisteredError.new({
      contextId: "app.identity",
    });

    expect(error.message).toContain("run(..., { identity })");
    expect(error.message).toContain('"app.identity"');
    expect(String(error.remediation)).toContain("auto-registers");
  });
});
