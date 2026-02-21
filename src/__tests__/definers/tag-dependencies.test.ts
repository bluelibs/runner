import {
  defineEvent,
  defineHook,
  defineResource,
  defineResourceMiddleware,
  defineTag,
  defineTask,
  defineTaskMiddleware,
} from "../../define";
import { defineError } from "../../definers/defineError";
import { run } from "../../run";

describe("Tag dependencies", () => {
  it("injects a typed accessor with all tagged definition categories", async () => {
    const featureTag = defineTag<{ group: string }>({
      id: "tests.tags.feature",
    });

    const taggedEvent = defineEvent({
      id: "tests.events.feature",
      tags: [featureTag.with({ group: "alpha" })],
    });

    const taggedHook = defineHook({
      id: "tests.hooks.feature",
      on: taggedEvent,
      tags: [featureTag.with({ group: "alpha" })],
      run: async () => undefined,
    });

    const taggedTaskMiddleware = defineTaskMiddleware({
      id: "tests.middleware.task.feature",
      tags: [featureTag.with({ group: "alpha" })],
      run: async ({ next, task }) => next(task.input),
    });

    const taggedResourceMiddleware = defineResourceMiddleware({
      id: "tests.middleware.resource.feature",
      tags: [featureTag.with({ group: "alpha" })],
      run: async ({ next }) => next(),
    });

    const taggedTask = defineTask({
      id: "tests.tasks.feature",
      tags: [featureTag.with({ group: "alpha" })],
      run: async () => "ok",
    });

    const taggedResource = defineResource({
      id: "tests.resources.feature",
      tags: [featureTag.with({ group: "alpha" })],
      init: async () => "value",
    });

    const taggedError = defineError({
      id: "tests.errors.feature",
      tags: [featureTag.with({ group: "alpha" })],
      format: () => "boom",
    });

    const inspectorTask = defineTask({
      id: "tests.tasks.inspectFeatureTag",
      dependencies: { featureTag },
      run: async (_input, deps) => {
        return {
          tasks: deps.featureTag.tasks.map((item) => ({
            id: item.definition.id,
            config: item.config?.group,
          })),
          resources: deps.featureTag.resources.map((item) => ({
            id: item.definition.id,
            config: item.config?.group,
          })),
          events: deps.featureTag.events.map((item) => ({
            id: item.definition.id,
            config: item.config?.group,
          })),
          hooks: deps.featureTag.hooks.map((item) => ({
            id: item.definition.id,
            config: item.config?.group,
          })),
          taskMiddlewares: deps.featureTag.taskMiddlewares.map((item) => ({
            id: item.definition.id,
            config: item.config?.group,
          })),
          resourceMiddlewares: deps.featureTag.resourceMiddlewares.map(
            (item) => ({
              id: item.definition.id,
              config: item.config?.group,
            }),
          ),
          errors: deps.featureTag.errors.map((item) => ({
            id: item.definition.id,
            config: item.config?.group,
          })),
        };
      },
    });

    const app = defineResource({
      id: "tests.resources.feature.app",
      register: [
        featureTag,
        taggedEvent,
        taggedHook,
        taggedTaskMiddleware,
        taggedResourceMiddleware,
        taggedTask,
        taggedResource,
        taggedError,
        inspectorTask,
      ],
      dependencies: { inspectorTask },
      init: async (_config, { inspectorTask }) => inspectorTask(),
    });

    const runtime = await run(app);
    expect(runtime.value).toEqual({
      tasks: [{ id: "tests.tasks.feature", config: "alpha" }],
      resources: [{ id: "tests.resources.feature", config: "alpha" }],
      events: [{ id: "tests.events.feature", config: "alpha" }],
      hooks: [{ id: "tests.hooks.feature", config: "alpha" }],
      taskMiddlewares: [
        { id: "tests.middleware.task.feature", config: "alpha" },
      ],
      resourceMiddlewares: [
        { id: "tests.middleware.resource.feature", config: "alpha" },
      ],
      errors: [{ id: "tests.errors.feature", config: "alpha" }],
    });
    await runtime.dispose();
  });

  it("filters tag accessor matches based on visibility", async () => {
    const privateTag = defineTag({
      id: "tests.tags.visibility",
    });

    const privateTask = defineTask({
      id: "tests.tasks.private.visibility",
      tags: [privateTag],
      run: async () => "private",
    });

    const moduleBoundary = defineResource({
      id: "tests.resources.module.visibility",
      register: [privateTask],
      exports: [],
    });

    const consumerTask = defineTask({
      id: "tests.tasks.consumer.visibility",
      dependencies: { privateTag },
      run: async (_input, deps) =>
        deps.privateTag.tasks.map((item) => item.definition.id),
    });

    const app = defineResource({
      id: "tests.resources.visibility.app",
      register: [privateTag, moduleBoundary, consumerTask],
      dependencies: { consumerTask },
      init: async (_config, { consumerTask }) => consumerTask(),
    });

    const runtime = await run(app);
    expect(runtime.value).toEqual([]);
    await runtime.dispose();
  });

  it("resolves optional missing tag dependencies to undefined", async () => {
    const missingTag = defineTag({
      id: "tests.tags.missing.optional",
    });

    const checkTask = defineTask({
      id: "tests.tasks.missing.optional",
      dependencies: { maybeMissingTag: missingTag.optional() },
      run: async (_input, deps) => deps.maybeMissingTag === undefined,
    });

    const app = defineResource({
      id: "tests.resources.missing.optional.app",
      register: [checkTask],
      dependencies: { checkTask },
      init: async (_config, { checkTask }) => checkTask(),
    });

    const runtime = await run(app);
    expect(runtime.value).toBe(true);
    await runtime.dispose();
  });

  it("throws for non-optional missing tag dependencies", async () => {
    const missingTag = defineTag({
      id: "tests.tags.missing.required",
    });

    const task = defineTask({
      id: "tests.tasks.missing.required",
      dependencies: { missingTag },
      run: async () => "never",
    });

    const app = defineResource({
      id: "tests.resources.missing.required.app",
      register: [task],
      dependencies: { task },
      init: async (_config, { task }) => task(),
    });

    await expect(run(app)).rejects.toThrow(
      /Dependency Tag tests\.tags\.missing\.required not found/i,
    );
  });

  it("expands tag dependencies into cycle detection edges", async () => {
    const httpTag = defineTag({
      id: "tests.tags.http.routes",
    });

    const registerHttpRoutes = defineTask({
      id: "tests.tasks.registerHttpRoutes",
      dependencies: { httpTag },
      run: async () => undefined,
    });

    const userRoute = defineTask({
      id: "tests.tasks.httpRoute.user",
      tags: [httpTag],
      dependencies: { registerHttpRoutes },
      run: async () => undefined,
    });

    const app = defineResource({
      id: "tests.resources.http.routes.app",
      register: [httpTag, registerHttpRoutes, userRoute],
    });

    await expect(run(app)).rejects.toThrow(/Circular dependencies detected/i);
  });
});
