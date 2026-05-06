import {
  defineEvent,
  defineHook,
  defineResource,
  defineResourceMiddleware,
  defineTag,
  defineTask,
  defineTaskMiddleware,
} from "../../../../define";
import type { IResource } from "../../../../defs";
import { defineError } from "../../../../definers/defineError";
import { SYNTHETIC_FRAMEWORK_ROOT_RESOURCE_ID } from "../../../../models/createSyntheticFrameworkRoot";
import { createOwnerScope } from "../../../../models/store/store-registry/OwnerScope";
import { createTestFixture } from "../../../test-utils";

describe("StoreRegistryWriter branches", () => {
  type ResourceSubtreeWithMiddlewareIds = {
    resources?: { middleware?: Array<{ use: { id: string } }> };
  };

  const getWriter = () => {
    const { store } = createTestFixture();
    const registry = (store as unknown as { registry: any }).registry;
    return registry.writer as {
      compileOwnedDefinition: (
        ownerResourceId: string,
        ownerIsFrameworkRoot: boolean,
        item: unknown,
        kind: string,
      ) => unknown;
      computeCanonicalId: (
        ownerResourceId: string,
        ownerIsFrameworkRoot: boolean,
        kind: string,
        currentId: string,
      ) => string;
      normalizeTaskMiddlewareAttachments: (task: any) => unknown;
      normalizeSubtreeTaskMiddlewareEntry: (
        ownerResourceId: unknown,
        ownerIsTransparentOrEntry: boolean | unknown,
        entry?: unknown,
      ) => unknown;
      normalizeSubtreeResourceMiddlewareEntry: (
        ownerResourceId: unknown,
        ownerIsTransparentOrEntry: boolean | unknown,
        entry?: unknown,
      ) => unknown;
      normalizeResourceSubtreeMiddlewareAttachments: (
        resource: any,
        config: unknown,
      ) => unknown;
      normalizeDefinitionTags: (tags: unknown) => Array<{ id: string }>;
      didArrayChange: <T>(
        source: ReadonlyArray<T>,
        next: ReadonlyArray<T>,
      ) => boolean;
      resolveOwnerResourceIdFromTaskId: (taskId: string) => string | null;
      computeRegistrationDeeply: <C>(
        element: IResource<C, any, any, any, any>,
        config?: C,
      ) => void;
    };
  };

  it("computes canonical ids for error/async-context and fallback kinds", () => {
    const writer = getWriter();

    expect(writer.computeCanonicalId("app", false, "error", "boom")).toBe(
      "app.errors.boom",
    );
    expect(
      writer.computeCanonicalId("app", false, "asyncContext", "request"),
    ).toBe("app.asyncContexts.request");
    expect(
      writer.computeCanonicalId("app", false, "unknown-kind", "item"),
    ).toBe("app.item");
  });

  it("keeps the framework root transparent and normal resources scoped", () => {
    const writer = getWriter();
    const childResource = defineResource({
      id: "child",
    });
    const leafResource = defineResource({
      id: "leaf",
    });

    expect(
      writer.compileOwnedDefinition("app", false, childResource, "resource"),
    ).toEqual(expect.objectContaining({ id: "app.child" }));
    expect(
      writer.compileOwnedDefinition(
        "runtime-framework-root",
        true,
        childResource,
        "resource",
      ),
    ).toBe(childResource);
    expect(
      writer.compileOwnedDefinition("app", false, leafResource, "resource"),
    ).toEqual(expect.objectContaining({ id: "app.leaf" }));

    expect(writer.computeCanonicalId("app", false, "resource", "child")).toBe(
      "app.child",
    );
    expect(
      writer.computeCanonicalId(
        "runtime-framework-root",
        true,
        "resource",
        "child",
      ),
    ).toBe("child");
    expect(
      writer.computeCanonicalId(
        "runtime-framework-root",
        true,
        "task",
        "child",
      ),
    ).toBe("tasks.child");
    expect(
      writer.computeCanonicalId(
        "runtime-framework-root",
        true,
        "event",
        "child",
      ),
    ).toBe("events.child");
    expect(
      writer.computeCanonicalId(
        "runtime-framework-root",
        true,
        "hook",
        "child",
      ),
    ).toBe("hooks.child");
    expect(
      writer.computeCanonicalId(
        "runtime-framework-root",
        true,
        "taskMiddleware",
        "child",
      ),
    ).toBe("middleware.task.child");
    expect(
      writer.computeCanonicalId(
        "runtime-framework-root",
        true,
        "resourceMiddleware",
        "child",
      ),
    ).toBe("middleware.resource.child");
    expect(
      writer.computeCanonicalId("runtime-framework-root", true, "tag", "child"),
    ).toBe("tags.child");
    expect(
      writer.computeCanonicalId(
        "runtime-framework-root",
        true,
        "error",
        "child",
      ),
    ).toBe("errors.child");
    expect(
      writer.computeCanonicalId(
        "runtime-framework-root",
        true,
        "asyncContext",
        "child",
      ),
    ).toBe("asyncContexts.child");
    expect(
      writer.computeCanonicalId(
        "runtime-framework-root",
        true,
        "unknown",
        "child",
      ),
    ).toBe("child");
  });

  it("allows resources to directly register both resources and tasks", () => {
    const writer = getWriter();
    const leaf = defineResource({
      id: "child-leaf",
    });
    const task = defineTask({
      id: "child-task",
      run: async () => "ok",
    });
    const root = defineResource({
      id: "root",
      register: [leaf, task],
    });

    expect(() => writer.computeRegistrationDeeply(root)).not.toThrow();
  });

  it("does not keep aliases when deep registration fails", () => {
    const { store } = createTestFixture();
    const registry = (store as unknown as { registry: any }).registry;
    const writer = registry.writer as {
      storeGenericItem: (item: unknown) => void;
      resolveRegisteredReferenceId: (reference: unknown) => string | undefined;
    };
    const child = defineResource<{ enabled: boolean }>({
      id: "child",
    });
    const configuredChild = child.with({ enabled: true });
    const ownerDefinition = defineResource({
      id: "owner",
      register: [configuredChild],
    });
    expect(Array.isArray(ownerDefinition.register)).toBe(true);
    if (!Array.isArray(ownerDefinition.register)) {
      return;
    }

    const owner = {
      ...ownerDefinition,
      register: [...ownerDefinition.register],
    };
    const storeGenericItem = jest
      .spyOn(writer, "storeGenericItem")
      .mockImplementation(() => {
        throw new Error("boom");
      });

    try {
      expect(() => registry.computeRegistrationDeeply(owner, {})).toThrow(
        "boom",
      );
      expect(registry.resolveRegisteredReferenceId(child)).toBeUndefined();
      expect(
        registry.resolveRegisteredReferenceId(configuredChild),
      ).toBeUndefined();
      expect(
        registry.resolveRegisteredReferenceId(owner.register[0]),
      ).toBeUndefined();
    } finally {
      storeGenericItem.mockRestore();
    }
  });

  it("stores framework-root tasks under top-level ids", () => {
    const writer = getWriter();
    const task = defineTask({
      id: "root-task",
      run: async () => "ok",
    });
    const root = defineResource({
      id: "runtime-framework-root",
      register: [task],
    });

    expect(() => writer.computeRegistrationDeeply(root)).not.toThrow();
  });

  it("fails fast on empty and reserved local names", () => {
    const writer = getWriter();

    expect(() => writer.computeCanonicalId("app", false, "task", " ")).toThrow(
      /non-empty strings/i,
    );
    expect(() =>
      writer.computeCanonicalId("app", false, "task", "tasks"),
    ).toThrow(/reserved by Runner/i);
  });

  it("normalizes subtree middleware entries for both object and direct attachment forms", () => {
    const writer = getWriter();
    const taskMiddleware = defineTaskMiddleware({
      id: "localTaskMw",
      run: async ({ next, task }) => next(task.input),
    });
    const resourceMiddleware = defineResourceMiddleware({
      id: "localResourceMw",
      run: async ({ next }) => next(),
    });

    const normalizedTaskEntry = writer.normalizeSubtreeTaskMiddlewareEntry(
      "app-owner",
      false,
      { use: taskMiddleware },
    ) as { use: { id: string } };
    expect(normalizedTaskEntry.use.id).toBe(
      "app-owner.middleware.task.localTaskMw",
    );

    const normalizedResourceEntry =
      writer.normalizeSubtreeResourceMiddlewareEntry("app-owner", false, {
        use: resourceMiddleware,
      }) as { use: { id: string } };
    expect(normalizedResourceEntry.use.id).toBe(
      "app-owner.middleware.resource.localResourceMw",
    );

    const normalizedDirectResource =
      writer.normalizeSubtreeResourceMiddlewareEntry(
        "app-owner",
        false,
        resourceMiddleware,
      ) as { id: string };
    expect(normalizedDirectResource.id).toBe(
      "app-owner.middleware.resource.localResourceMw",
    );
  });

  it("supports the legacy subtree normalization signature for framework-root owners", () => {
    const writer = getWriter();
    const taskMiddleware = defineTaskMiddleware({
      id: "legacyTaskMw",
      run: async ({ next, task }) => next(task.input),
    });

    const normalizedTaskEntry = writer.normalizeSubtreeTaskMiddlewareEntry(
      "runtime-framework-root",
      true,
      { use: taskMiddleware },
    ) as { use: { id: string } };

    expect(normalizedTaskEntry.use.id).toBe("middleware.task.legacyTaskMw");
  });

  it("defaults legacy subtree normalization signatures to non-framework owners", () => {
    const writer = getWriter();
    const taskMiddleware = defineTaskMiddleware({
      id: "legacyDefaultTaskMw",
      run: async ({ next, task }) => next(task.input),
    });

    const normalizedTaskEntry = writer.normalizeSubtreeTaskMiddlewareEntry(
      "app-owner",
      { use: taskMiddleware },
    ) as { use: { id: string } };

    expect(normalizedTaskEntry.use.id).toBe(
      "app-owner.middleware.task.legacyDefaultTaskMw",
    );
  });

  it("keeps framework-root owner scope semantics for string overloads", () => {
    const writer = getWriter();
    const middleware = defineResourceMiddleware({
      id: "frameworkRootMw",
      run: async ({ next }) => next(),
    });

    const normalizedFromString = writer.normalizeSubtreeResourceMiddlewareEntry(
      SYNTHETIC_FRAMEWORK_ROOT_RESOURCE_ID,
      {
        use: middleware,
      },
    ) as { use: { id: string } };
    const normalizedFromOwnerScope =
      writer.normalizeSubtreeResourceMiddlewareEntry(
        createOwnerScope(SYNTHETIC_FRAMEWORK_ROOT_RESOURCE_ID),
        {
          use: middleware,
        },
      ) as { use: { id: string } };

    expect(normalizedFromString.use.id).toBe(
      "middleware.resource.frameworkRootMw",
    );
    expect(normalizedFromString.use.id).toBe(normalizedFromOwnerScope.use.id);
  });

  it("normalizes resource subtree policies for both local and dotted middleware ids", () => {
    const { store } = createTestFixture();
    const registry = (store as unknown as { registry: any }).registry;
    const writer = registry.writer as {
      normalizeResourceSubtreeMiddlewareAttachments: (
        resource: any,
        config: unknown,
      ) => unknown;
    };
    const middleware = defineResourceMiddleware({
      id: "localSubtreeMw",
      run: async ({ next }) => next(),
    });

    const changedResource = defineResource({
      id: "app-owner",
      subtree: {
        resources: {
          middleware: [{ use: middleware }],
        },
      },
    });
    const changed = writer.normalizeResourceSubtreeMiddlewareAttachments(
      changedResource,
      {},
    ) as {
      resources?: { middleware?: Array<{ use: { id: string } }> };
    };
    expect(changed.resources?.middleware?.[0]?.use.id).toBe(
      "app-owner.middleware.resource.localSubtreeMw",
    );

    const canonicalMiddleware = {
      ...defineResourceMiddleware({
        id: "absolute",
        run: async ({ next }) => next(),
      }),
      id: "app-owner.middleware.resource.absolute",
    };
    registry.storeResourceMiddleware(canonicalMiddleware);

    const unchangedResource = defineResource({
      id: "app-owner",
      subtree: {
        resources: {
          middleware: [
            {
              use: canonicalMiddleware,
            },
          ],
        },
      },
    });
    const unchanged = writer.normalizeResourceSubtreeMiddlewareAttachments(
      unchangedResource,
      {},
    );
    const normalizedUnchanged = unchanged as ResourceSubtreeWithMiddlewareIds;
    expect(normalizedUnchanged.resources?.middleware?.[0]?.use.id).toBe(
      "app-owner.middleware.resource.absolute",
    );
  });

  it("normalizes task subtree direct middleware entries and returns task-only subtree updates", () => {
    const writer = getWriter();
    const middleware = defineTaskMiddleware({
      id: "localTaskSubtreeMw",
      run: async ({ next, task }) => next(task.input),
    });

    const resource = defineResource({
      id: "app-owner",
      subtree: {
        tasks: {
          middleware: [middleware],
        },
      },
    });

    const normalized = writer.normalizeResourceSubtreeMiddlewareAttachments(
      resource,
      {},
    ) as {
      tasks?: { middleware?: Array<{ id: string }> };
      resources?: unknown;
    };

    expect(normalized.tasks?.middleware?.[0]?.id).toBe(
      "app-owner.middleware.task.localTaskSubtreeMw",
    );
    expect(normalized.resources).toBeUndefined();
  });

  it("keeps top-level task middleware unchanged when task ids are not resource-owned", () => {
    const writer = getWriter();
    const middleware = defineTaskMiddleware({
      id: "shared-task-middleware",
      run: async ({ next, task }) => next(task.input),
    });
    const task = defineTask({
      id: "top-level-task",
      middleware: [middleware],
      run: async () => "ok",
    });

    expect(writer.resolveOwnerResourceIdFromTaskId(task.id)).toBeNull();
    expect(writer.normalizeTaskMiddlewareAttachments(task)).toBe(
      task.middleware,
    );
  });

  it("keeps owned task middleware attachments on their local id while resolving them by alias", () => {
    const { store } = createTestFixture();
    const registry = (store as unknown as { registry: any }).registry;
    const writer = registry.writer as {
      compileOwnedDefinition: (
        ownerResourceId: string,
        ownerIsFrameworkRoot: boolean,
        item: ReturnType<typeof defineTask>,
        kind: "task",
      ) => ReturnType<typeof defineTask>;
      normalizeTaskMiddlewareAttachments: (
        task: ReturnType<typeof defineTask>,
      ) => Array<{ id: string }>;
    };
    const middleware = defineTaskMiddleware({
      id: "local-task-middleware",
      run: async ({ next, task }) => next(task.input),
    });
    const task = defineTask({
      id: "owned-task",
      middleware: [middleware],
      run: async () => "ok",
    });
    const ownedTask = writer.compileOwnedDefinition(
      "app-owner",
      false,
      task as any,
      "task",
    );

    const normalized = writer.normalizeTaskMiddlewareAttachments(ownedTask);

    expect(normalized[0]).toBe(middleware);
    expect(normalized[0]?.id).toBe("local-task-middleware");
    expect(registry.resolveDefinitionId(middleware)).toBe(
      "app-owner.middleware.task.local-task-middleware",
    );
  });

  it("leaves owned task middleware attachments unchanged when they already use a canonical id", () => {
    const writer = getWriter();
    const middleware = {
      ...defineTaskMiddleware({
        id: "absolute",
        run: async ({ next, task }) => next(task.input),
      }),
      id: "app-owner.middleware.task.absolute",
    };
    const task = defineTask({
      id: "owned-task",
      middleware: [middleware],
      run: async () => "ok",
    });
    const ownedTask = writer.compileOwnedDefinition(
      "app-owner",
      false,
      task,
      "task",
    ) as ReturnType<typeof defineTask>;

    const normalized = writer.normalizeTaskMiddlewareAttachments(ownedTask) as
      | Array<{ id: string }>
      | undefined;

    expect(normalized).toHaveLength(1);
    expect(normalized?.[0]).toBe(middleware);
    expect(normalized?.[0]?.id).toBe("app-owner.middleware.task.absolute");
  });

  it("normalizes definition tags through aliases and detects array changes", () => {
    const { store } = createTestFixture();
    const registry = (store as unknown as { registry: any }).registry;
    const writer = registry.writer as {
      normalizeDefinitionTags: (tags: unknown) => Array<{ id: string }>;
      didArrayChange: <T>(
        source: ReadonlyArray<T>,
        next: ReadonlyArray<T>,
      ) => boolean;
    };
    const tag = defineTag({
      id: "localTag",
    });
    registry.registerDefinitionAlias(tag, "app-tags-localTag");

    const normalizedTags = writer.normalizeDefinitionTags([tag]);
    expect(normalizedTags[0].id).toBe("app-tags-localTag");

    expect(writer.didArrayChange([1], [1, 2])).toBe(true);
    expect(writer.didArrayChange([1], [2])).toBe(true);
    expect(writer.didArrayChange([1], [1])).toBe(false);
  });

  it("keeps tag helper methods functional after id normalization", () => {
    const { store } = createTestFixture();
    const registry = (store as unknown as { registry: any }).registry;
    const writer = registry.writer as {
      normalizeDefinitionTags: (tags: unknown) => Array<any>;
    };

    const tag = defineTag<{ scope: string }>({
      id: "localTag",
    });
    registry.registerDefinitionAlias(tag, "app.tags.localTag");

    const normalized = writer.normalizeDefinitionTags([tag])[0] as typeof tag;
    const configured = normalized.with({ scope: "x" });

    expect(normalized.id).toBe("app.tags.localTag");
    expect(normalized.exists([configured])).toBe(true);
    expect(normalized.extract([configured])).toEqual({ scope: "x" });
  });

  it("reindexes late-registered hook tags after canonical tag ids become known", () => {
    const { store } = createTestFixture();
    const registry = (store as unknown as { registry: any }).registry;

    const tag = defineTag({
      id: "late-hook-tag",
    });
    const event = defineEvent({
      id: "late-hook-event",
    });
    const hook = defineHook({
      id: "late-hook",
      on: event,
      tags: [tag],
      run: async () => undefined,
    });
    const root = defineResource({
      id: "late-hook-root",
      register: [event, hook, tag],
    });

    registry.computeRegistrationDeeply(root, {});

    expect(registry.getTagAccessor(tag).hooks).toHaveLength(1);
  });

  it("covers owned-registration alias guard branches for unknown and id-less items", () => {
    const { store } = createTestFixture();
    const registry = (store as unknown as { registry: any }).registry;
    const compiler = (registry.writer as any).ownedRegistrationCompiler as {
      registerCompiledItemAliases: (
        originalItem: unknown,
        compiledItem: unknown,
      ) => void;
    };
    const task = defineTask({
      id: "alias-guard-task",
      run: async () => "ok",
    });

    expect(() => compiler.registerCompiledItemAliases(123, 123)).not.toThrow();
    expect(() =>
      compiler.registerCompiledItemAliases(task, undefined),
    ).not.toThrow();
  });

  it("preserves error helper methods when compiling scoped local ids", () => {
    const { store } = createTestFixture();
    const registry = (store as unknown as { registry: any }).registry;

    const localError = defineError({
      id: "boom",
      format: () => "boom",
    });
    const ownerDefinition = defineResource({
      id: "app-owner",
      register: [localError],
    });
    expect(Array.isArray(ownerDefinition.register)).toBe(true);
    if (!Array.isArray(ownerDefinition.register)) {
      return;
    }
    const owner = {
      ...ownerDefinition,
      register: [...ownerDefinition.register],
    };

    registry.computeRegistrationDeeply(owner, {});

    const stored = store.errors.get("app-owner.errors.boom");
    expect(stored).toBeDefined();
    expect(typeof stored?.throw).toBe("function");
    expect(typeof stored?.new).toBe("function");
    expect(stored?.new({}).id).toBe("app-owner.errors.boom");
  });

  it("preserves error helper identity across scoped id compilation", () => {
    const { store } = createTestFixture();
    const registry = (store as unknown as { registry: any }).registry;

    const localError = defineError<{ code: number }>({
      id: "boom",
      format: ({ code }) => `boom ${code}`,
    });
    const ownerDefinition = defineResource({
      id: "app-owner",
      register: [localError],
    });
    expect(Array.isArray(ownerDefinition.register)).toBe(true);
    if (!Array.isArray(ownerDefinition.register)) {
      return;
    }
    const owner = {
      ...ownerDefinition,
      register: [...ownerDefinition.register],
    };

    registry.computeRegistrationDeeply(owner, {});

    const stored = store.errors.get("app-owner.errors.boom");
    expect(stored).toBeDefined();
    if (!stored) {
      return;
    }

    expect(localError.id).toBe("boom");
    expect(stored.id).toBe("app-owner.errors.boom");

    const scopedError = stored.new({ code: 1 });
    const localScopedError = localError.new({ code: 2 });

    expect(localError.is(scopedError)).toBe(true);
    expect(stored.is(localScopedError)).toBe(true);
  });

  it("returns the original subtree and entries when middleware ids are already canonical", () => {
    const { store } = createTestFixture();
    const registry = (store as unknown as { registry: any }).registry;
    const writer = registry.writer as {
      normalizeResourceSubtreeMiddlewareAttachments: (
        resource: any,
        config: unknown,
      ) => unknown;
      normalizeSubtreeTaskMiddlewareEntry: (
        ownerResourceId: string,
        ownerIsTransparent: boolean,
        entry: unknown,
      ) => unknown;
      normalizeSubtreeResourceMiddlewareEntry: (
        ownerResourceId: string,
        ownerIsTransparent: boolean,
        entry: unknown,
      ) => unknown;
    };

    const taskMiddleware = defineTaskMiddleware({
      id: "shared-task-middleware",
      run: async ({ next, task }) => next(task.input),
    });
    const resourceMiddleware = defineResourceMiddleware({
      id: "shared-resource-middleware",
      run: async ({ next }) => next(),
    });
    registry.storeTaskMiddleware(taskMiddleware);
    registry.storeResourceMiddleware(resourceMiddleware);

    const taskEntry = { use: taskMiddleware };
    const resourceEntry = { use: resourceMiddleware };
    const resource = defineResource({
      id: "app-owner",
      subtree: {
        tasks: {
          middleware: [taskEntry],
        },
        resources: {
          middleware: [resourceEntry],
        },
      },
    });

    expect(
      writer.normalizeSubtreeTaskMiddlewareEntry("app-owner", false, taskEntry),
    ).toBe(taskEntry);
    expect(
      writer.normalizeSubtreeResourceMiddlewareEntry(
        "app-owner",
        false,
        resourceEntry,
      ),
    ).toBe(resourceEntry);
    expect(
      writer.normalizeResourceSubtreeMiddlewareAttachments(resource, {}),
    ).toEqual(resource.subtree);
  });
});
