import {
  defineEvent,
  defineHook,
  defineResource,
  defineResourceMiddleware,
  defineTag,
  defineTask,
  defineTaskMiddleware,
} from "../../../define";
import { defineError } from "../../../definers/defineError";

// Type-only tests for tag dependency accessors.
{
  const featureTag = defineTag<
    { group: string },
    { tenantId: string },
    { ok: boolean }
  >({
    id: "types.tags.feature",
  });

  const taggedTask = defineTask({
    id: "types.tasks.feature",
    tags: [featureTag.with({ group: "alpha" })],
    run: async (input) => ({ ok: input.tenantId.length > 0 }),
  });

  const taggedResource = defineResource({
    id: "types.resources.feature",
    tags: [featureTag.with({ group: "alpha" })],
    init: async (config) => ({ ok: config.tenantId.length > 0 }),
  });

  const taggedEvent = defineEvent({
    id: "types.events.feature",
    tags: [featureTag.with({ group: "alpha" })],
  });

  const taggedHook = defineHook({
    id: "types.hooks.feature",
    on: taggedEvent,
    tags: [featureTag.with({ group: "alpha" })],
    run: async () => undefined,
  });

  const taggedTaskMiddleware = defineTaskMiddleware({
    id: "types.middleware.task.feature",
    tags: [featureTag.with({ group: "alpha" })],
    run: async ({ next, task }) => next(task.input),
  });

  const taggedResourceMiddleware = defineResourceMiddleware({
    id: "types.middleware.resource.feature",
    tags: [featureTag.with({ group: "alpha" })],
    run: async ({ next }) => next(),
  });

  const taggedError = defineError({
    id: "types.errors.feature",
    tags: [featureTag.with({ group: "alpha" })],
    format: () => "boom",
  });

  defineResource({
    id: "types.resources.feature.user",
    register: [
      featureTag,
      taggedTask,
      taggedResource,
      taggedEvent,
      taggedHook,
      taggedTaskMiddleware,
      taggedResourceMiddleware,
      taggedError,
    ],
    dependencies: {
      featureTag,
      maybeFeatureTag: featureTag.optional(),
    },
    init: async (_config, deps) => {
      const taskEntry = deps.featureTag.tasks[0];
      const resourceEntry = deps.featureTag.resources[0];
      const eventEntry = deps.featureTag.events[0];
      const hookEntry = deps.featureTag.hooks[0];
      const taskMiddlewareEntry = deps.featureTag.taskMiddlewares[0];
      const resourceMiddlewareEntry = deps.featureTag.resourceMiddlewares[0];
      const errorEntry = deps.featureTag.errors[0];

      if (
        taskEntry &&
        resourceEntry &&
        eventEntry &&
        hookEntry &&
        taskMiddlewareEntry &&
        resourceMiddlewareEntry &&
        errorEntry
      ) {
        const group: string | undefined = taskEntry.config?.group;
        const group2: string | undefined = resourceEntry.config?.group;
        void group;
        void group2;

        taskEntry.definition.run({ tenantId: "acme" }, {} as any);
        // @ts-expect-error contract-enforced input
        taskEntry.definition.run({ bad: true }, {} as any);

        resourceEntry.definition.init?.(
          { tenantId: "acme" },
          {} as any,
          {} as any,
        );
        // @ts-expect-error contract-enforced config
        resourceEntry.definition.init?.({ bad: true }, {} as any, {} as any);

        eventEntry.definition.id;
        hookEntry.definition.id;
        taskMiddlewareEntry.definition.id;
        resourceMiddlewareEntry.definition.id;
        errorEntry.definition.id;
      }

      if (deps.maybeFeatureTag) {
        deps.maybeFeatureTag.tasks;
      }
    },
  });
}
