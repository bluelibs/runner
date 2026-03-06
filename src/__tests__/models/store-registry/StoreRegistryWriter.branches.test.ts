import {
  defineResource,
  defineResourceMiddleware,
  defineTag,
  defineTaskMiddleware,
} from "../../../define";
import { defineError } from "../../../definers/defineError";
import { createTestFixture } from "../../test-utils";

describe("StoreRegistryWriter branches", () => {
  type ResourceSubtreeWithMiddlewareIds = {
    resources?: { middleware?: Array<{ use: { id: string } }> };
  };

  const getWriter = () => {
    const { store } = createTestFixture();
    const registry = (store as unknown as { registry: any }).registry;
    return registry.writer as {
      computeCanonicalId: (
        ownerResourceId: string,
        ownerIsGateway: boolean,
        kind: string,
        currentId: string,
      ) => string;
      normalizeSubtreeTaskMiddlewareEntry: (
        ownerResourceId: string,
        entry: unknown,
      ) => unknown;
      normalizeSubtreeResourceMiddlewareEntry: (
        ownerResourceId: string,
        entry: unknown,
      ) => unknown;
      normalizeResourceSubtreeMiddlewareAttachments: (resource: any) => unknown;
      normalizeDefinitionTags: (tags: unknown) => Array<{ id: string }>;
      didArrayChange: <T>(
        source: ReadonlyArray<T>,
        next: ReadonlyArray<T>,
      ) => boolean;
    };
  };

  it("computes canonical ids for error/async-context and fallback kinds", () => {
    const writer = getWriter();

    expect(writer.computeCanonicalId("app", false, "error", "boom")).toBe(
      "app.errors.boom",
    );
    expect(
      writer.computeCanonicalId("app", false, "asyncContext", "request"),
    ).toBe(
      "app.ctx.request",
    );
    expect(
      writer.computeCanonicalId("app", false, "unknown-kind", "item"),
    ).toBe(
      "app.item",
    );
  });

  it("fails fast on empty and reserved local names", () => {
    const writer = getWriter();

    expect(() => writer.computeCanonicalId("app", false, "task", " ")).toThrow(
      /non-empty strings/i,
    );
    expect(
      () => writer.computeCanonicalId("app", false, "task", "tasks"),
    ).toThrow(
      /reserved by Runner/i,
    );
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
      "app.owner",
      { use: taskMiddleware },
    ) as { use: { id: string } };
    expect(normalizedTaskEntry.use.id).toBe(
      "app.owner.middleware.task.localTaskMw",
    );

    const normalizedResourceEntry =
      writer.normalizeSubtreeResourceMiddlewareEntry("app.owner", {
        use: resourceMiddleware,
      }) as { use: { id: string } };
    expect(normalizedResourceEntry.use.id).toBe(
      "app.owner.middleware.resource.localResourceMw",
    );

    const normalizedDirectResource =
      writer.normalizeSubtreeResourceMiddlewareEntry(
        "app.owner",
        resourceMiddleware,
      ) as { id: string };
    expect(normalizedDirectResource.id).toBe(
      "app.owner.middleware.resource.localResourceMw",
    );
  });

  it("normalizes resource subtree policies for both local and dotted middleware ids", () => {
    const writer = getWriter();
    const middleware = defineResourceMiddleware({
      id: "localSubtreeMw",
      run: async ({ next }) => next(),
    });

    const changedResource = defineResource({
      id: "app.owner",
      subtree: {
        resources: {
          middleware: [{ use: middleware }],
        },
      },
    });
    const changed = writer.normalizeResourceSubtreeMiddlewareAttachments(
      changedResource,
    ) as {
      resources?: { middleware?: Array<{ use: { id: string } }> };
    };
    expect(changed.resources?.middleware?.[0]?.use.id).toBe(
      "app.owner.middleware.resource.localSubtreeMw",
    );

    const unchangedResource = defineResource({
      id: "app.owner",
      subtree: {
        resources: {
          middleware: [
            {
              use: defineResourceMiddleware({
                id: "app.owner.middleware.resource.absolute",
                run: async ({ next }) => next(),
              }),
            },
          ],
        },
      },
    });
    const unchanged =
      writer.normalizeResourceSubtreeMiddlewareAttachments(unchangedResource);
    const normalizedUnchanged = unchanged as ResourceSubtreeWithMiddlewareIds;
    expect(normalizedUnchanged.resources?.middleware?.[0]?.use.id).toBe(
      "app.owner.middleware.resource.app.owner.middleware.resource.absolute",
    );
  });

  it("normalizes task subtree direct middleware entries and returns task-only subtree updates", () => {
    const writer = getWriter();
    const middleware = defineTaskMiddleware({
      id: "localTaskSubtreeMw",
      run: async ({ next, task }) => next(task.input),
    });

    const resource = defineResource({
      id: "app.owner",
      subtree: {
        tasks: {
          middleware: [middleware],
        },
      },
    });

    const normalized = writer.normalizeResourceSubtreeMiddlewareAttachments(
      resource,
    ) as {
      tasks?: { middleware?: Array<{ id: string }> };
      resources?: unknown;
    };

    expect(normalized.tasks?.middleware?.[0]?.id).toBe(
      "app.owner.middleware.task.localTaskSubtreeMw",
    );
    expect(normalized.resources).toBeUndefined();
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
    registry.registerDefinitionAlias(tag, "app.tags.localTag");

    const normalizedTags = writer.normalizeDefinitionTags([tag]);
    expect(normalizedTags[0].id).toBe("app.tags.localTag");

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
      id: "app.owner",
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

    const stored = store.errors.get("app.owner.errors.boom");
    expect(stored).toBeDefined();
    expect(typeof stored?.throw).toBe("function");
    expect(typeof stored?.new).toBe("function");
    expect(stored?.new({}).id).toBe("app.owner.errors.boom");
  });
});
