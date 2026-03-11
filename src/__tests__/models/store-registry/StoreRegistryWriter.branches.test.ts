import {
  defineResource,
  defineResourceMiddleware,
  defineTag,
  defineTask,
  defineTaskMiddleware,
} from "../../../define";
import type { IResource } from "../../../defs";
import { defineError } from "../../../definers/defineError";
import { RunnerErrorId } from "../../../errors";
import { createTestFixture } from "../../test-utils";

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
        ownerIsGateway: boolean,
        item: unknown,
        kind: string,
      ) => unknown;
      computeCanonicalId: (
        ownerResourceId: string,
        ownerIsGateway: boolean,
        kind: string,
        currentId: string,
        childIsGateway?: boolean,
      ) => string;
      normalizeTaskMiddlewareAttachments: (task: any) => unknown;
      normalizeSubtreeTaskMiddlewareEntry: (
        ownerResourceId: string,
        entry: unknown,
      ) => unknown;
      normalizeSubtreeResourceMiddlewareEntry: (
        ownerResourceId: string,
        entry: unknown,
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

  it("keeps first-level gateways local and accumulates gateway-only ancestry for nested gateways", () => {
    const writer = getWriter();
    const gatewayResource = defineResource({
      id: "child",
      gateway: true,
    });
    const nonGatewayResource = defineResource({
      id: "leaf",
    });

    expect(
      writer.compileOwnedDefinition("app", false, gatewayResource, "resource"),
    ).toBe(gatewayResource);
    expect(
      writer.compileOwnedDefinition(
        "gateway",
        true,
        gatewayResource,
        "resource",
      ),
    ).toEqual(expect.objectContaining({ id: "gateway.child" }));
    expect(
      writer.compileOwnedDefinition(
        "gateway",
        true,
        nonGatewayResource,
        "resource",
      ),
    ).toBe(nonGatewayResource);

    expect(
      writer.computeCanonicalId("app", false, "resource", "child", true),
    ).toBe("child");
    expect(
      writer.computeCanonicalId("gateway", true, "resource", "child", true),
    ).toBe("gateway.child");
    expect(
      writer.computeCanonicalId("gateway", true, "resource", "leaf", false),
    ).toBe("leaf");
    expect(writer.computeCanonicalId("gateway", true, "task", "child")).toBe(
      "tasks.child",
    );
    expect(writer.computeCanonicalId("gateway", true, "event", "child")).toBe(
      "events.child",
    );
    expect(writer.computeCanonicalId("gateway", true, "hook", "child")).toBe(
      "hooks.child",
    );
    expect(
      writer.computeCanonicalId("gateway", true, "taskMiddleware", "child"),
    ).toBe("middleware.task.child");
    expect(
      writer.computeCanonicalId("gateway", true, "resourceMiddleware", "child"),
    ).toBe("middleware.resource.child");
    expect(writer.computeCanonicalId("gateway", true, "tag", "child")).toBe(
      "tags.child",
    );
    expect(writer.computeCanonicalId("gateway", true, "error", "child")).toBe(
      "errors.child",
    );
    expect(
      writer.computeCanonicalId("gateway", true, "asyncContext", "child"),
    ).toBe("asyncContexts.child");
    expect(writer.computeCanonicalId("gateway", true, "unknown", "child")).toBe(
      "child",
    );
  });

  it("allows gateway resources to directly register both gateway and non-gateway resources", () => {
    const writer = getWriter();
    const leaf = defineResource({
      id: "gateway-leaf",
    });
    const nestedGateway = defineResource({
      id: "gateway-nested",
      gateway: true,
      register: [leaf],
    });
    const rootGateway = defineResource({
      id: "gateway-root",
      gateway: true,
      register: [nestedGateway],
    });

    expect(() => writer.computeRegistrationDeeply(rootGateway)).not.toThrow();
  });

  it("fails fast when a gateway directly registers a task", () => {
    const writer = getWriter();
    const task = defineTask({
      id: "gateway-invalid-task",
      run: async () => "ok",
    });
    const gateway = defineResource({
      id: "gateway-invalid-root",
      gateway: true,
      register: [task],
    });

    try {
      writer.computeRegistrationDeeply(gateway);
      fail("Expected gateway validation to throw");
    } catch (error) {
      expect((error as { id?: string }).id).toBe(
        RunnerErrorId.ResourceGatewayInvalidContents,
      );
      expect((error as { message?: string }).message).toContain(
        'Task "gateway-invalid-task"',
      );
    }
  });

  it("renders unknown gateway direct registrations with a safe fallback id", () => {
    const writer = getWriter();
    const gateway = defineResource({
      id: "gateway-invalid-unknown-root",
      gateway: true,
      register: [{ nope: true } as never],
    });

    try {
      writer.computeRegistrationDeeply(gateway);
      fail("Expected gateway validation to throw");
    } catch (error) {
      expect((error as { id?: string }).id).toBe(
        RunnerErrorId.ResourceGatewayInvalidContents,
      );
      expect((error as { message?: string }).message).toContain(
        'Unknown registration "<unknown>"',
      );
    }
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
      { use: taskMiddleware },
    ) as { use: { id: string } };
    expect(normalizedTaskEntry.use.id).toBe(
      "app-owner.middleware.task.localTaskMw",
    );

    const normalizedResourceEntry =
      writer.normalizeSubtreeResourceMiddlewareEntry("app-owner", {
        use: resourceMiddleware,
      }) as { use: { id: string } };
    expect(normalizedResourceEntry.use.id).toBe(
      "app-owner.middleware.resource.localResourceMw",
    );

    const normalizedDirectResource =
      writer.normalizeSubtreeResourceMiddlewareEntry(
        "app-owner",
        resourceMiddleware,
      ) as { id: string };
    expect(normalizedDirectResource.id).toBe(
      "app-owner.middleware.resource.localResourceMw",
    );
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
        entry: unknown,
      ) => unknown;
      normalizeSubtreeResourceMiddlewareEntry: (
        ownerResourceId: string,
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
      writer.normalizeSubtreeTaskMiddlewareEntry("app-owner", taskEntry),
    ).toBe(taskEntry);
    expect(
      writer.normalizeSubtreeResourceMiddlewareEntry(
        "app-owner",
        resourceEntry,
      ),
    ).toBe(resourceEntry);
    expect(
      writer.normalizeResourceSubtreeMiddlewareAttachments(resource, {}),
    ).toEqual(resource.subtree);
  });
});
