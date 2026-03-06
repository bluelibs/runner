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
import { symbolTagConfiguredFrom } from "../../types/symbols";
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
      (registry as any).recordSourceIdAlias(123, "registry-coverage-primitive"),
    ).not.toThrow();
    expect(() =>
      (registry as any).recordCanonicalSourceId(
        undefined,
        "registry-coverage-primitive",
      ),
    ).not.toThrow();
    expect(() =>
      (registry as any).recordCanonicalSourceId(
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

    (registry as any).definitionAliasesBySourceId.set("registry-coverage-raw", {
      size: 1,
      values: () => ({
        next: () => ({
          value: 123,
        }),
      }),
    });
    expect(registry.resolveDefinitionId("registry-coverage-raw")).toBe(
      "registry-coverage-raw",
    );

    (registry as any).sourceIdsByCanonicalId.set("registry-coverage-same", {
      size: 2,
      values: () => ({
        next: () => ({
          value: "registry-coverage-same",
        }),
      }),
      [Symbol.iterator]: function* () {
        yield "registry-coverage-same";
        yield "registry-coverage-same";
      },
    });
    expect(registry.getDisplayId("registry-coverage-same")).toBe(
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
});
