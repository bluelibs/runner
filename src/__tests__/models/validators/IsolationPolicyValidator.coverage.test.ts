import { normalizeIsolationEntries } from "../../../models/validators/IsolationPolicyValidator";
import { ValidatorContext } from "../../../models/validators/ValidatorContext";
import { scope, subtreeOf } from "../../../public";
import { defineTag } from "../../../define";

function createValidatorContext(options?: {
  registeredIds?: string[];
  resolveDefinitionId?: (reference: unknown) => string | undefined;
}) {
  const registry = {
    tasks: new Map(),
    resources: new Map(),
    events: new Map(),
    errors: new Map(),
    asyncContexts: new Map(),
    taskMiddlewares: new Map(),
    resourceMiddlewares: new Map(),
    tags: new Map(),
    hooks: new Map(),
    resolveDefinitionId: options?.resolveDefinitionId,
    getDisplayId: (id: string) => id,
  };
  const ctx = new ValidatorContext(registry as any);
  for (const id of options?.registeredIds ?? []) {
    ctx.trackRegisteredId(id);
  }
  return ctx;
}

describe("IsolationPolicyValidator coverage", () => {
  it("uses raw subtree ids when resolution misses and reports unknown targets twice for direct filters", () => {
    const resource = {
      id: "validator.coverage.subtree.direct",
    };
    const ctx = createValidatorContext({
      resolveDefinitionId: () => undefined,
    });
    const onUnknownTarget = jest.fn(() => undefined as never);

    const normalized = normalizeIsolationEntries(ctx, {
      entries: [subtreeOf(resource as never)],
      onInvalidEntry: (entry) => {
        throw new Error(`invalid:${String(entry)}`);
      },
      onUnknownTarget,
    });

    expect((normalized[0] as { resourceId: string }).resourceId).toBe(
      resource.id,
    );
    expect(onUnknownTarget).toHaveBeenCalledTimes(2);
    expect(onUnknownTarget).toHaveBeenNthCalledWith(1, resource.id);
    expect(onUnknownTarget).toHaveBeenNthCalledWith(2, resource.id);
  });

  it("reports unknown targets twice for subtree filters nested inside scope()", () => {
    const resource = {
      id: "validator.coverage.subtree.scope",
    };
    const ctx = createValidatorContext({
      resolveDefinitionId: () => undefined,
    });
    const onUnknownTarget = jest.fn(() => undefined as never);

    normalizeIsolationEntries(ctx, {
      entries: [scope(subtreeOf(resource as never))],
      onInvalidEntry: () => {
        throw new Error("invalid");
      },
      onUnknownTarget,
    });

    expect(onUnknownTarget).toHaveBeenCalledTimes(2);
    expect(onUnknownTarget).toHaveBeenNthCalledWith(1, resource.id);
    expect(onUnknownTarget).toHaveBeenNthCalledWith(2, resource.id);
  });

  it("fails fast when a resolved isolation entry keeps a non-string id", () => {
    const ctx = createValidatorContext({
      registeredIds: ["validator.coverage.resolved"],
      resolveDefinitionId: () => "validator.coverage.resolved",
    });

    expect(() =>
      normalizeIsolationEntries(ctx, {
        entries: [{ id: 123 } as any],
        onInvalidEntry: () => {
          throw new Error("invalid");
        },
        onUnknownTarget: () => {
          throw new Error("unknown");
        },
      }),
    ).toThrow("invalid");
  });

  it("keeps direct tag references unchanged when their ids are already resolved", () => {
    const ctx = createValidatorContext({
      registeredIds: ["validator.coverage.tag"],
      resolveDefinitionId: (reference) =>
        reference && typeof reference === "object"
          ? ((reference as { id?: string }).id ?? undefined)
          : undefined,
    });
    const tag = defineTag({
      id: "validator.coverage.tag",
    });

    const normalized = normalizeIsolationEntries(ctx, {
      entries: [tag as any],
      onInvalidEntry: () => {
        throw new Error("invalid");
      },
      onUnknownTarget: () => {
        throw new Error("unknown");
      },
    });

    expect(normalized[0]).toBe(tag);
  });
});
