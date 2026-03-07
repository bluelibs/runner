import {
  normalizeIsolationEntries,
  validateIsolationPolicies,
} from "../../../models/validators/IsolationPolicyValidator";
import { ValidatorContext } from "../../../models/validators/ValidatorContext";
import { scope, subtreeOf } from "../../../public";
import { defineTag } from "../../../define";
import {
  isolateExportsUnknownTargetError,
  isolateInvalidExportsError,
} from "../../../errors";

function createValidatorContext(options?: {
  registeredIds?: string[];
  resolveDefinitionId?: (reference: unknown) => string | undefined;
  resources?: Array<{ id: string; isolate?: unknown }>;
}) {
  const registry = {
    tasks: new Map(),
    resources: new Map(
      (options?.resources ?? []).map((resource) => [resource.id, { resource }]),
    ),
    events: new Map(),
    errors: new Map(),
    asyncContexts: new Map(),
    taskMiddlewares: new Map(),
    resourceMiddlewares: new Map(),
    tags: new Map(),
    hooks: new Map(),
    visibilityTracker: {
      recordIsolation: jest.fn(),
      recordExports: jest.fn(),
    },
    resolveDefinitionId: options?.resolveDefinitionId,
    getDisplayId: (id: string) => id,
  };
  const ctx = new ValidatorContext(registry as any);
  for (const id of options?.registeredIds ?? []) {
    ctx.trackRegisteredId(id);
  }
  return ctx;
}

function expectThrownErrorId(action: () => void, errorId: string): void {
  try {
    action();
    throw new Error(`Expected error id "${errorId}"`);
  } catch (error) {
    expect((error as { id?: string }).id).toBe(errorId);
  }
}

describe("IsolationPolicyValidator coverage", () => {
  it("uses raw subtree ids when resolution misses and reports unknown targets once for direct filters", () => {
    const resource = {
      id: "validator-coverage-subtree-direct",
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
    expect(onUnknownTarget).toHaveBeenCalledTimes(1);
    expect(onUnknownTarget).toHaveBeenNthCalledWith(1, resource.id);
  });

  it("reports unknown targets once for subtree filters nested inside scope()", () => {
    const resource = {
      id: "validator-coverage-subtree-scope",
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

    expect(onUnknownTarget).toHaveBeenCalledTimes(1);
    expect(onUnknownTarget).toHaveBeenNthCalledWith(1, resource.id);
  });

  it("treats manually crafted subtree filters with invalid ids as invalid entries", () => {
    const ctx = createValidatorContext();

    expect(() =>
      normalizeIsolationEntries(ctx, {
        entries: [
          {
            _subtreeFilter: true,
            resourceId: "",
          } as any,
        ],
        onInvalidEntry: () => {
          throw new Error("invalid");
        },
        onUnknownTarget: () => {
          throw new Error("unknown");
        },
      }),
    ).toThrow("invalid");
  });

  it("treats manually crafted subtree filters with invalid types as invalid entries", () => {
    const ctx = createValidatorContext();

    expect(() =>
      normalizeIsolationEntries(ctx, {
        entries: [
          {
            _subtreeFilter: true,
            resourceId: "validator-coverage-manual",
            types: ["not-real"],
          } as any,
        ],
        onInvalidEntry: () => {
          throw new Error("invalid");
        },
        onUnknownTarget: () => {
          throw new Error("unknown");
        },
      }),
    ).toThrow("invalid");
  });

  it("treats manually crafted subtree filters with non-array types as invalid entries", () => {
    const ctx = createValidatorContext();

    expect(() =>
      normalizeIsolationEntries(ctx, {
        entries: [
          {
            _subtreeFilter: true,
            resourceId: "validator-coverage-manual",
            types: "task",
          } as any,
        ],
        onInvalidEntry: () => {
          throw new Error("invalid");
        },
        onUnknownTarget: () => {
          throw new Error("unknown");
        },
      }),
    ).toThrow("invalid");
  });

  it("falls back to the raw subtree resource id when no resource reference is preserved", () => {
    const ctx = createValidatorContext({
      registeredIds: ["validator-coverage-manual"],
      resolveDefinitionId: () => undefined,
    });

    const normalized = normalizeIsolationEntries(ctx, {
      entries: [
        {
          _subtreeFilter: true,
          resourceId: "validator-coverage-manual",
        } as any,
      ],
      onInvalidEntry: () => {
        throw new Error("invalid");
      },
      onUnknownTarget: () => {
        throw new Error("unknown");
      },
    });

    expect((normalized[0] as { resourceId: string }).resourceId).toBe(
      "validator-coverage-manual",
    );
  });

  it("fails fast when a resolved isolation entry keeps a non-string id", () => {
    const ctx = createValidatorContext({
      registeredIds: ["validator-coverage-resolved"],
      resolveDefinitionId: () => "validator-coverage-resolved",
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
      registeredIds: ["validator-coverage-tag"],
      resolveDefinitionId: (reference) =>
        reference && typeof reference === "object"
          ? ((reference as { id?: string }).id ?? undefined)
          : undefined,
    });
    const tag = defineTag({
      id: "validator-coverage-tag",
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

  it("throws the exports invalid-entry error for string entries during policy validation", () => {
    const resourceId = "validator-coverage-exports-invalid";
    const ctx = createValidatorContext({
      resources: [
        {
          id: resourceId,
          isolate: {
            exports: ["invalid-export-target"],
          },
        },
      ],
    });

    expectThrownErrorId(
      () => validateIsolationPolicies(ctx),
      isolateInvalidExportsError.id,
    );
  });

  it("throws the exports unknown-target error for unresolved export references during policy validation", () => {
    const resourceId = "validator-coverage-exports-unknown";
    const unknownTargetId = "validator-coverage-exports-missing-target";
    const ctx = createValidatorContext({
      resources: [
        {
          id: resourceId,
          isolate: {
            exports: [{ id: unknownTargetId }],
          },
        },
      ],
      resolveDefinitionId: (reference) =>
        reference && typeof reference === "object"
          ? ((reference as { id?: string }).id ?? undefined)
          : undefined,
    });

    expectThrownErrorId(
      () => validateIsolationPolicies(ctx),
      isolateExportsUnknownTargetError.id,
    );
  });

  it("rejects raw strings passed as isolation entries", () => {
    const ctx = createValidatorContext();

    expect(() =>
      normalizeIsolationEntries(ctx, {
        entries: ["raw-string-entry"],
        onInvalidEntry: () => {
          throw new Error("invalid");
        },
        onUnknownTarget: () => {
          throw new Error("unknown");
        },
      }),
    ).toThrow("invalid");
  });

  it("rejects unknown entry types (e.g. numbers) in isolation entries", () => {
    const ctx = createValidatorContext();

    expect(() =>
      normalizeIsolationEntries(ctx, {
        entries: [42 as any],
        onInvalidEntry: () => {
          throw new Error("invalid");
        },
        onUnknownTarget: () => {
          throw new Error("unknown");
        },
      }),
    ).toThrow("invalid");
  });

  it("rejects raw strings inside scope targets", () => {
    const ctx = createValidatorContext();

    expect(() =>
      normalizeIsolationEntries(ctx, {
        entries: [scope("raw-string-target" as any)],
        onInvalidEntry: () => {
          throw new Error("invalid");
        },
        onUnknownTarget: () => {
          throw new Error("unknown");
        },
      }),
    ).toThrow("invalid");
  });

  it("rejects unknown entry types inside scope targets", () => {
    const ctx = createValidatorContext();

    expect(() =>
      normalizeIsolationEntries(ctx, {
        entries: [scope(99 as any)],
        onInvalidEntry: () => {
          throw new Error("invalid");
        },
        onUnknownTarget: () => {
          throw new Error("unknown");
        },
      }),
    ).toThrow("invalid");
  });

  it("reports unresolvable definition entries as invalid", () => {
    const ctx = createValidatorContext({
      resolveDefinitionId: () => undefined,
    });

    expect(() =>
      normalizeIsolationEntries(ctx, {
        entries: [{ id: "unresolvable-def" }],
        onInvalidEntry: () => {
          throw new Error("invalid");
        },
        onUnknownTarget: () => {
          throw new Error("unknown");
        },
      }),
    ).toThrow("invalid");
  });
});
