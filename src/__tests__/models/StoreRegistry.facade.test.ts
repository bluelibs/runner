import {
  defineEvent,
  defineHook,
  defineResource,
  defineResourceMiddleware,
  defineTag,
  defineTask,
  defineTaskMiddleware,
} from "../../define";
import { defineAsyncContext } from "../../definers/defineAsyncContext";
import { defineError } from "../../definers/defineError";
import { Store } from "../../models/Store";
import {
  symbolDefinitionIdentity,
  symbolTagConfiguredFrom,
} from "../../types/symbols";
import { createTestFixture } from "../test-utils";

describe("StoreRegistry facade delegates", () => {
  let store: Store;

  beforeEach(() => {
    const fixture = createTestFixture();
    ({ store } = fixture);
  });

  it("forwards direct registry writer calls to the writer services", () => {
    const registry = (store as unknown as { registry: any }).registry;

    const tag = defineTag({ id: "registry-delegate-tag" });
    registry.storeTag(tag);

    const event = defineEvent({
      id: "registry-delegate-event",
      tags: [tag],
    });
    registry.storeEvent(event);

    const hook = defineHook({
      id: "registry-delegate-hook",
      on: event,
      tags: [tag],
      run: async () => undefined,
    });
    registry.storeHook(hook);
    registry.storeHook(
      defineHook({
        id: hook.id,
        on: event,
        tags: [tag],
        run: async () => undefined,
      }),
      "override",
    );

    const taskMiddleware = defineTaskMiddleware({
      id: "registry-delegate-task-middleware",
      tags: [tag],
      run: async ({ next, task }) => next(task.input),
    });
    registry.storeTaskMiddleware(taskMiddleware);
    registry.storeTaskMiddleware(
      defineTaskMiddleware({
        id: taskMiddleware.id,
        tags: [tag],
        run: async ({ next, task }) => next(task.input),
      }),
      "override",
    );

    const resourceMiddleware = defineResourceMiddleware({
      id: "registry-delegate-resource-middleware",
      tags: [tag],
      run: async ({ next }) => next(),
    });
    registry.storeResourceMiddleware(resourceMiddleware);
    registry.storeResourceMiddleware(
      defineResourceMiddleware({
        id: resourceMiddleware.id,
        tags: [tag],
        run: async ({ next }) => next(),
      }),
      "override",
    );

    const task = defineTask({
      id: "registry-delegate-task",
      tags: [tag],
      run: async () => "task",
    });
    registry.storeTask(task);
    registry.storeTask(
      defineTask({
        id: task.id,
        tags: [tag],
        run: async () => "task-override",
      }),
      "override",
    );

    const resource = defineResource({
      id: "registry-delegate-resource",
      tags: [tag],
      init: async () => "resource",
    });
    registry.storeResource(resource);
    registry.storeResource(
      defineResource({
        id: resource.id,
        tags: [tag],
        init: async () => "resource-override",
      }),
      "override",
    );

    const withConfigResource = defineResource<{ enabled: boolean }>({
      id: "registry-delegate-resource-with-config",
      tags: [tag],
      init: async (config) => config.enabled,
    });
    registry.storeResourceWithConfig(
      withConfigResource.with({ enabled: true }),
    );
    registry.storeResourceWithConfig(
      withConfigResource.with({ enabled: false }),
      "override",
    );

    const typedError = defineError({
      id: "registry-delegate-error",
      tags: [tag],
      format: () => "error",
    });
    registry.storeError(typedError);

    const asyncContext = defineAsyncContext<{ requestId: string }>({
      id: "registry-delegate-async-context",
    });
    registry.storeAsyncContext(asyncContext);

    expect(store.tags.has(tag.id)).toBe(true);
    expect(store.events.has(event.id)).toBe(true);
    expect(store.hooks.has(hook.id)).toBe(true);
    expect(store.taskMiddlewares.has(taskMiddleware.id)).toBe(true);
    expect(store.resourceMiddlewares.has(resourceMiddleware.id)).toBe(true);
    expect(store.tasks.has(task.id)).toBe(true);
    expect(store.resources.has(resource.id)).toBe(true);
    expect(store.resources.has(withConfigResource.id)).toBe(true);
    expect(store.errors.has(typedError.id)).toBe(true);
    expect(store.asyncContexts.has(asyncContext.id)).toBe(true);
  });

  it("covers writer id resolution fallbacks for null and id-less values", () => {
    const registry = (store as unknown as { registry: any }).registry;
    const writer = registry.writer as {
      resolveRegisterableId: (item: unknown) => string | undefined;
    };

    expect(writer.resolveRegisterableId(null)).toBeUndefined();
    expect(writer.resolveRegisterableId(undefined)).toBeUndefined();
    expect(writer.resolveRegisterableId(123)).toBeUndefined();
  });

  it("handles writer registration failures for id-less items without rollback lookup", () => {
    const registry = (store as unknown as { registry: any }).registry;
    const root = {
      id: "registry-delegate-invalid-item-root",
      register: [123 as any],
      dependencies: {},
      middleware: [],
      overrides: [],
      subtree: undefined,
      tags: [],
    };

    expect(() => registry.computeRegistrationDeeply(root)).toThrow(
      /Unknown item type/,
    );
  });

  it("keeps alias registration as a no-op for primitives and resolves resource-with-config ids", () => {
    const registry = (store as unknown as { registry: any }).registry;
    const resource = defineResource<{ enabled: boolean }>({
      id: "registry-alias-resource",
      init: async (config) => config.enabled,
    });
    const configured = resource.with({ enabled: true });

    expect(() =>
      registry.registerDefinitionAlias(null, "ignored"),
    ).not.toThrow();
    expect(() => registry.registerDefinitionAlias(42, "ignored")).not.toThrow();
    expect(() =>
      registry.registerDefinitionAlias("primitive", "ignored"),
    ).not.toThrow();
    expect(() =>
      registry.registerDefinitionAlias({}, "ignored-object"),
    ).not.toThrow();
    expect(() =>
      registry.registerDefinitionAlias({ id: "" } as any, "ignored-empty-id"),
    ).not.toThrow();

    expect(registry.resolveDefinitionId(configured)).toBe(resource.id);
  });

  it("fails fast when a definition alias is remapped to a different id", () => {
    const registry = (store as unknown as { registry: any }).registry;
    const reference = {};

    registry.registerDefinitionAlias(reference, "app-alias-first");
    expect(() =>
      registry.registerDefinitionAlias(reference, "app-alias-second"),
    ).toThrow(/cannot be remapped/i);
  });

  it("resolves configured-from aliases when the configured source is already registered", () => {
    const registry = (store as unknown as { registry: any }).registry;
    const configuredFrom = { id: "registry-configured-from-source" };
    const reference = {
      [symbolTagConfiguredFrom]: configuredFrom,
    };

    registry.definitionAliases.set(
      configuredFrom,
      "registry-configured-from-canonical",
    );

    expect(registry.resolveDefinitionId(reference)).toBe(
      "registry-configured-from-canonical",
    );
  });

  it("fails fast when a shared definition identity is remapped to a different id", () => {
    const registry = (store as unknown as { registry: any }).registry;
    const event = defineEvent({ id: "registry-identity-remap-event" });
    const clonedReference = Object.defineProperty(
      { id: "registry-identity-remap-clone" },
      symbolDefinitionIdentity,
      {
        value: (event as unknown as Record<symbol, unknown>)[
          symbolDefinitionIdentity
        ],
      },
    );

    registry.registerDefinitionAlias(event, "events.identity.one");

    expect(() =>
      registry.registerDefinitionAlias(clonedReference, "events.identity.two"),
    ).toThrow(/cannot be remapped/i);
  });

  it("fails fast when a definition alias is remapped to a different id", () => {
    const registry = (store as unknown as { registry: any }).registry;
    const reference = {};

    registry.registerDefinitionAlias(reference, "app-alias-first");
    expect(() =>
      registry.registerDefinitionAlias(reference, "app-alias-second"),
    ).toThrow(/cannot be remapped/i);
  });

  it("covers alias fallback helpers and consumer-id normalization fallbacks", () => {
    const registry = (store as unknown as { registry: any }).registry;
    const tag = defineTag({
      id: "registry-coverage-tag",
    });
    const task = defineTask({
      id: "registry-coverage-task",
      tags: [tag],
      run: async () => "ok",
    });
    const resource = defineResource({
      id: "registry-coverage-resource",
      tags: [tag],
      init: async () => "ok",
    });

    registry.storeTag(tag);
    registry.storeTask(task);
    registry.storeResource(resource);

    const configuredFromFunction = Object.assign(() => undefined, {
      [symbolTagConfiguredFrom]: () => undefined,
    });
    expect(
      registry.resolveDefinitionId(configuredFromFunction),
    ).toBeUndefined();

    expect(() =>
      registry.registerDefinitionAlias(
        123 as any,
        "registry-coverage-primitive",
      ),
    ).not.toThrow();
    expect(() =>
      registry.registerDefinitionAlias(
        undefined,
        "registry-coverage-primitive",
      ),
    ).not.toThrow();
    expect(() =>
      registry.registerDefinitionAlias(
        () => undefined,
        "registry-coverage-function",
      ),
    ).not.toThrow();
    expect(() =>
      registry.registerDefinitionAlias(
        { id: 123 } as any,
        "registry-coverage-invalid-id",
      ),
    ).not.toThrow();

    registry.registerDefinitionAlias(
      { id: "registry-coverage-raw" },
      "registry.coverage.one",
    );
    registry.registerDefinitionAlias(
      { id: "registry-coverage-raw" },
      "registry.coverage.two",
    );
    expect(registry.resolveDefinitionId("registry-coverage-raw")).toBe(
      "registry-coverage-raw",
    );

    registry.registerDefinitionAlias(
      { id: "registry-coverage-same" },
      "registry-coverage-same",
    );
    expect(registry.resolveDefinitionId("registry-coverage-same")).toBe(
      "registry-coverage-same",
    );

    const accessor = registry.getTagAccessor(tag, {
      consumerId: { not: "resolvable" } as any,
    });
    expect(
      accessor.tasks.map(
        (entry: { definition: { id: string } }) => entry.definition.id,
      ),
    ).toEqual([task.id]);
  });

  it("returns an empty resolution set for hooks without explicit targets or wildcard targets", () => {
    const registry = (store as unknown as { registry: any }).registry;

    expect(
      registry.resolveHookTargets({
        id: "registry-empty-hook",
        on: undefined,
      }),
    ).toEqual([]);
    expect(
      registry.resolveHookTargets({
        id: "registry-wildcard-hook",
        on: "*",
      }),
    ).toEqual([]);
  });

  it("invalidates cached hook selector resolutions after additional registrations", () => {
    const registry = (store as unknown as { registry: any }).registry;
    const firstEvent = defineEvent({
      id: "registry-hook-cache-first-event",
    });
    const secondEvent = defineEvent({
      id: "registry-hook-cache-second-event",
    });
    const hook = defineHook({
      id: "registry-hook-cache-hook",
      on: () => true,
      run: async () => undefined,
    });

    store.storeGenericItem(firstEvent);
    store.storeGenericItem(hook);

    expect(registry.resolveHookTargets(hook)).toEqual([
      { event: firstEvent, provenance: "selector" },
    ]);

    store.storeGenericItem(secondEvent);

    expect(registry.resolveHookTargets(hook)).toEqual([
      { event: firstEvent, provenance: "selector" },
      { event: secondEvent, provenance: "selector" },
    ]);
  });

  it("returns defensive copies from cached hook target resolutions", () => {
    const registry = (store as unknown as { registry: any }).registry;
    const event = defineEvent({
      id: "registry-hook-cache-copy-event",
    });
    const hook = defineHook({
      id: "registry-hook-cache-copy-hook",
      on: () => true,
      run: async () => undefined,
    });

    store.storeGenericItem(event);
    store.storeGenericItem(hook);

    const firstResolution = registry.resolveHookTargets(hook);
    firstResolution[0]!.provenance = "exact";
    firstResolution.length = 0;

    expect(registry.resolveHookTargets(hook)).toEqual([
      { event, provenance: "selector" },
    ]);
  });
});
