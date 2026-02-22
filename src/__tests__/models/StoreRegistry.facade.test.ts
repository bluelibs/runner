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
import { createTestFixture } from "../test-utils";

describe("StoreRegistry facade delegates", () => {
  let store: Store;

  beforeEach(() => {
    const fixture = createTestFixture();
    ({ store } = fixture);
  });

  it("forwards direct registry writer calls to the writer services", () => {
    const registry = (store as unknown as { registry: any }).registry;

    const tag = defineTag({ id: "registry.delegate.tag" });
    registry.storeTag(tag);

    const event = defineEvent({
      id: "registry.delegate.event",
      tags: [tag],
    });
    registry.storeEvent(event);

    const hook = defineHook({
      id: "registry.delegate.hook",
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
      id: "registry.delegate.task-middleware",
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
      id: "registry.delegate.resource-middleware",
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
      id: "registry.delegate.task",
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
      id: "registry.delegate.resource",
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
      id: "registry.delegate.resource.with-config",
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
      id: "registry.delegate.error",
      tags: [tag],
      format: () => "error",
    });
    registry.storeError(typedError);

    const asyncContext = defineAsyncContext<{ requestId: string }>({
      id: "registry.delegate.async-context",
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
});
