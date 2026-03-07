import { StoreValidator } from "../../models/StoreValidator";
import { defineTag } from "../../define";
import { createTestFixture } from "../test-utils";
import { scope, subtreeOf } from "../../public";

type RegistryLike = {
  tasks: Map<string, unknown>;
  resources: Map<string, unknown>;
  events: Map<string, unknown>;
  errors: Map<string, unknown>;
  asyncContexts: Map<string, unknown>;
  taskMiddlewares: Map<string, unknown>;
  resourceMiddlewares: Map<string, unknown>;
  tags: Map<string, unknown>;
  hooks: Map<string, unknown>;
};

function createRegistryStub(seedTaskId?: string): RegistryLike {
  const tasks = new Map<string, unknown>();
  if (seedTaskId) {
    tasks.set(seedTaskId, {});
  }

  return {
    tasks,
    resources: new Map<string, unknown>(),
    events: new Map<string, unknown>(),
    errors: new Map<string, unknown>(),
    asyncContexts: new Map<string, unknown>(),
    taskMiddlewares: new Map<string, unknown>(),
    resourceMiddlewares: new Map<string, unknown>(),
    tags: new Map<string, unknown>(),
    hooks: new Map<string, unknown>(),
  };
}

describe("StoreValidator regressions", () => {
  it("seeds pre-existing registry IDs into duplicate checks", () => {
    const seededRegistry = createRegistryStub("seeded-task");
    const validator = new StoreValidator(seededRegistry as never);

    expect(() => validator.checkIfIDExists("seeded-task")).toThrow(
      /already registered/i,
    );
  });

  it("throws Unknown duplicate type when id cache is stale", () => {
    const registry = createRegistryStub();
    const validator = new StoreValidator(registry as never) as unknown as {
      checkIfIDExists: (id: string) => void;
      registeredIds: Set<string>;
    };
    validator.registeredIds.add("ghost-id");

    expect(() => validator.checkIfIDExists("ghost-id")).toThrow(
      /already registered/i,
    );
  });

  it("classifies duplicate ids as Resource when resource map owns the id", () => {
    const registry = createRegistryStub() as RegistryLike;
    registry.resources.set("seeded-resource", {});
    const validator = new StoreValidator(registry as never) as unknown as {
      checkIfIDExists: (id: string) => void;
      registeredIds: Set<string>;
    };
    validator.registeredIds.add("seeded-resource");

    expect(() => validator.checkIfIDExists("seeded-resource")).toThrow(
      /Resource .*already registered/i,
    );
  });

  it("rejects null in storeGenericItem guard", () => {
    const { store } = createTestFixture();

    expect(() => store.storeGenericItem(null as never)).toThrow(
      /unknown item type/i,
    );
  });

  it("rejects primitive values in storeGenericItem guard", () => {
    const { store } = createTestFixture();

    expect(() => store.storeGenericItem(42 as never)).toThrow(
      /unknown item type/i,
    );
  });

  it("normalizes isolate tag entries to aliased ids", () => {
    const { store } = createTestFixture();
    const registry = (store as unknown as { registry: any }).registry;
    const validator = registry.getValidator() as {
      normalizeIsolationEntries: (input: {
        entries: ReadonlyArray<unknown>;
        onInvalidEntry: (entry: unknown) => never;
        onUnknownTarget: (targetId: string) => never;
      }) => Array<{ id: string }>;
      registeredIds: Set<string>;
    };

    const tag = defineTag({
      id: "validator-isolate-alias-tag",
    });
    registry.registerDefinitionAlias(
      tag,
      "app-tags-validator-isolate-alias-tag",
    );
    validator.registeredIds.add("app-tags-validator-isolate-alias-tag");

    const normalized = validator.normalizeIsolationEntries({
      entries: [tag],
      onInvalidEntry: (entry) => {
        throw new Error(`invalid:${String(entry)}`);
      },
      onUnknownTarget: (targetId) => {
        throw new Error(`unknown:${targetId}`);
      },
    });

    expect(normalized).toHaveLength(1);
    expect(normalized[0].id).toBe("app-tags-validator-isolate-alias-tag");
    expect(normalized[0]).not.toBe(tag);
  });

  it("expands scope() subtree targets without throwing when resource is registered", () => {
    const { store } = createTestFixture();
    const registry = (store as unknown as { registry: any }).registry;
    const validator = registry.getValidator() as {
      normalizeIsolationEntries: (input: {
        entries: ReadonlyArray<unknown>;
        onInvalidEntry: (entry: unknown) => never;
        onUnknownTarget: (targetId: string) => never;
      }) => Array<unknown>;
      registeredIds: Set<string>;
    };

    const resource = {
      id: "validator-scope-subtree-owner",
    };
    validator.registeredIds.add(resource.id);

    const normalized = validator.normalizeIsolationEntries({
      entries: [scope(subtreeOf(resource as never))],
      onInvalidEntry: () => {
        throw new Error("invalid");
      },
      onUnknownTarget: () => {
        throw new Error("unknown");
      },
    }) as Array<{ targets: Array<{ _subtreeFilter: true }> }>;

    expect(normalized).toHaveLength(1);
    expect(normalized[0].targets[0]._subtreeFilter).toBe(true);
  });

  it("rejects non-definition function references in isolation entries", () => {
    const { store } = createTestFixture();
    const registry = (store as unknown as { registry: any }).registry;
    const validator = registry.getValidator() as {
      normalizeIsolationEntries: (input: {
        entries: ReadonlyArray<unknown>;
        onInvalidEntry: (entry: unknown) => never;
        onUnknownTarget: (targetId: string) => never;
      }) => Array<unknown>;
      registeredIds: Set<string>;
    };

    const functionReference = Object.assign(() => undefined, {
      id: "validator-scope-function-ref",
    });
    validator.registeredIds.add(functionReference.id);

    expect(() =>
      validator.normalizeIsolationEntries({
        entries: [functionReference],
        onInvalidEntry: () => {
          throw new Error("invalid");
        },
        onUnknownTarget: () => {
          throw new Error("unknown");
        },
      }),
    ).toThrow("invalid");
  });

  it("reports invalid non-resolvable targets inside scope()", () => {
    const { store } = createTestFixture();
    const registry = (store as unknown as { registry: any }).registry;
    const validator = registry.getValidator() as {
      normalizeIsolationEntries: (input: {
        entries: ReadonlyArray<unknown>;
        onInvalidEntry: (entry: unknown) => never;
        onUnknownTarget: (targetId: string) => never;
      }) => Array<unknown>;
    };

    expect(() =>
      validator.normalizeIsolationEntries({
        entries: [scope({ not: "resolvable" } as never)],
        onInvalidEntry: () => {
          throw new Error("invalid");
        },
        onUnknownTarget: () => {
          throw new Error("unknown");
        },
      }),
    ).toThrow("invalid");
  });

  it("reports unknown resolvable targets inside scope()", () => {
    const { store } = createTestFixture();
    const registry = (store as unknown as { registry: any }).registry;
    const validator = registry.getValidator() as {
      normalizeIsolationEntries: (input: {
        entries: ReadonlyArray<unknown>;
        onInvalidEntry: (entry: unknown) => never;
        onUnknownTarget: (targetId: string) => never;
      }) => Array<unknown>;
    };

    expect(() =>
      validator.normalizeIsolationEntries({
        entries: [scope({ id: "validator-scope-unknown" } as never)],
        onInvalidEntry: () => {
          throw new Error("invalid");
        },
        onUnknownTarget: () => {
          throw new Error("unknown");
        },
      }),
    ).toThrow("unknown");
  });

  it("rejects string exports during normalization", () => {
    const { store } = createTestFixture();
    const registry = (store as unknown as { registry: any }).registry;
    const validator = registry.getValidator() as {
      normalizeExportEntries: (input: {
        entries: ReadonlyArray<unknown>;
        onInvalidEntry: (entry: unknown) => never;
        onUnknownTarget: (targetId: string) => never;
      }) => Array<unknown>;
    };

    expect(() =>
      validator.normalizeExportEntries({
        entries: ["validator-exports-invalid"],
        onInvalidEntry: () => {
          throw new Error("invalid");
        },
        onUnknownTarget: () => {
          throw new Error("unknown");
        },
      }),
    ).toThrow("invalid");
  });

  it("reports unknown object exports", () => {
    const { store } = createTestFixture();
    const registry = (store as unknown as { registry: any }).registry;
    const validator = registry.getValidator() as {
      normalizeExportEntries: (input: {
        entries: ReadonlyArray<unknown>;
        onInvalidEntry: (entry: unknown) => never;
        onUnknownTarget: (targetId: string) => never;
      }) => Array<unknown>;
    };

    expect(() =>
      validator.normalizeExportEntries({
        entries: [{ id: "validator-exports-unknown" }],
        onInvalidEntry: () => {
          throw new Error("invalid");
        },
        onUnknownTarget: () => {
          throw new Error("unknown");
        },
      }),
    ).toThrow("unknown");
  });

  it("normalizes isolate exports tag entries to aliased ids", () => {
    const { store } = createTestFixture();
    const registry = (store as unknown as { registry: any }).registry;
    const validator = registry.getValidator() as {
      normalizeExportEntries: (input: {
        entries: ReadonlyArray<unknown>;
        onInvalidEntry: (entry: unknown) => never;
        onUnknownTarget: (targetId: string) => never;
      }) => Array<{ id: string }>;
      registeredIds: Set<string>;
    };

    const tag = defineTag({
      id: "validator-exports-alias-tag",
    });
    registry.registerDefinitionAlias(
      tag,
      "app-tags-validator-exports-alias-tag",
    );
    validator.registeredIds.add("app-tags-validator-exports-alias-tag");

    const normalized = validator.normalizeExportEntries({
      entries: [tag],
      onInvalidEntry: () => {
        throw new Error("invalid");
      },
      onUnknownTarget: () => {
        throw new Error("unknown");
      },
    });

    expect(normalized).toHaveLength(1);
    expect(normalized[0].id).toBe("app-tags-validator-exports-alias-tag");
    expect(normalized[0]).not.toBe(tag);
  });
});
