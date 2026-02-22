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
import { normalizeTags } from "../../models/store-registry/types";

describe("Tag dependency accessor caching", () => {
  it("returns cached results on repeated accessor property reads", async () => {
    const featureTag = defineTag<{ label: string }>({
      id: "tests.tags.cache.accessor",
    });

    const taggedEvent = defineEvent({
      id: "tests.events.cache.accessor",
      tags: [featureTag.with({ label: "cached" })],
    });

    const taggedHook = defineHook({
      id: "tests.hooks.cache.accessor",
      on: taggedEvent,
      tags: [featureTag.with({ label: "cached" })],
      run: async () => undefined,
    });

    const taggedTaskMw = defineTaskMiddleware({
      id: "tests.middleware.task.cache.accessor",
      tags: [featureTag.with({ label: "cached" })],
      run: async ({ next, task }) => next(task.input),
    });

    const taggedResourceMw = defineResourceMiddleware({
      id: "tests.middleware.resource.cache.accessor",
      tags: [featureTag.with({ label: "cached" })],
      run: async ({ next }) => next(),
    });

    const taggedError = defineError({
      id: "tests.errors.cache.accessor",
      tags: [featureTag.with({ label: "cached" })],
      format: () => "boom",
    });

    const taggedTask = defineTask({
      id: "tests.tasks.cache.accessor",
      tags: [featureTag.with({ label: "cached" })],
      run: async () => "cached-task",
    });

    const taggedResource = defineResource({
      id: "tests.resources.cache.accessor",
      tags: [featureTag.with({ label: "cached" })],
      init: async () => "cached-resource",
    });

    const inspectorTask = defineTask({
      id: "tests.tasks.cache.accessor.inspector",
      dependencies: { featureTag },
      run: async (_input, deps) => {
        const accessor = deps.featureTag;

        // First reads populate caches
        const tasks1 = accessor.tasks;
        const resources1 = accessor.resources;
        const events1 = accessor.events;
        const hooks1 = accessor.hooks;
        const taskMws1 = accessor.taskMiddlewares;
        const resourceMws1 = accessor.resourceMiddlewares;
        const errors1 = accessor.errors;

        // Second reads exercise cache-hit (else) branches
        return {
          tasksCached: accessor.tasks === tasks1,
          resourcesCached: accessor.resources === resources1,
          eventsCached: accessor.events === events1,
          hooksCached: accessor.hooks === hooks1,
          taskMwsCached: accessor.taskMiddlewares === taskMws1,
          resourceMwsCached: accessor.resourceMiddlewares === resourceMws1,
          errorsCached: accessor.errors === errors1,
        };
      },
    });

    const app = defineResource({
      id: "tests.resources.cache.accessor.app",
      register: [
        featureTag,
        taggedEvent,
        taggedHook,
        taggedTaskMw,
        taggedResourceMw,
        taggedError,
        taggedTask,
        taggedResource,
        inspectorTask,
      ],
      dependencies: { inspectorTask, taggedResource },
      init: async (_config, { inspectorTask }) => inspectorTask(),
    });

    const runtime = await run(app);
    expect(runtime.value).toEqual({
      tasksCached: true,
      resourcesCached: true,
      eventsCached: true,
      hooksCached: true,
      taskMwsCached: true,
      resourceMwsCached: true,
      errorsCached: true,
    });
    await runtime.dispose();
  });

  it("caches tagged task runner across multiple calls", async () => {
    const featureTag = defineTag({
      id: "tests.tags.runner.cache",
    });

    const taggedTask = defineTask({
      id: "tests.tasks.runner.cache.tagged",
      tags: [featureTag],
      run: async () => "runner-cache-result",
    });

    const inspectorTask = defineTask({
      id: "tests.tasks.runner.cache.inspector",
      dependencies: { featureTag },
      run: async (_input, deps) => {
        const taskEntry = deps.featureTag.tasks[0];
        if (!taskEntry?.run) return null;

        // First call populates cachedRunner
        const first = await taskEntry.run(undefined);
        // Second call hits cache else branch in ensureRunner
        const second = await taskEntry.run(undefined);
        return { first, second };
      },
    });

    const app = defineResource({
      id: "tests.resources.runner.cache.app",
      register: [featureTag, taggedTask, inspectorTask],
      dependencies: { inspectorTask },
      init: async (_config, { inspectorTask }) => inspectorTask(),
    });

    const runtime = await run(app);
    expect(runtime.value).toEqual({
      first: "runner-cache-result",
      second: "runner-cache-result",
    });
    await runtime.dispose();
  });

  it("caches direct StoreRegistry tag accessor task matches on repeated reads", async () => {
    const featureTag = defineTag({
      id: "tests.tags.registry.cache.direct",
    });

    const taggedTask = defineTask({
      id: "tests.tasks.registry.cache.direct",
      tags: [featureTag],
      run: async () => "ok",
    });

    const app = defineResource({
      id: "tests.resources.registry.cache.direct.app",
      register: [featureTag, taggedTask],
    });

    const runtime = await run(app);
    const accessor = runtime.store.getTagAccessor(featureTag);
    const firstRead = accessor.tasks;
    const secondRead = accessor.tasks;

    expect(secondRead).toBe(firstRead);
    await runtime.dispose();
  });
});

describe("defineTag.extract", () => {
  it("iterates past non-matching tags before finding a match", () => {
    const tagA = defineTag<{ x: number }>({ id: "extract.tag.a" });
    const tagB = defineTag({ id: "extract.tag.b" });

    const result = tagA.extract([tagB, tagA.with({ x: 42 })]);
    expect(result).toEqual({ x: 42 });
  });

  it("returns undefined when no tag matches", () => {
    const tagA = defineTag({ id: "extract.tag.only.a" });
    const tagB = defineTag({ id: "extract.tag.only.b" });

    expect(tagA.extract([tagB])).toBeUndefined();
  });
});

describe("normalizeTags", () => {
  it("filters out invalid candidate entries", () => {
    const result = normalizeTags([
      null,
      42,
      { noId: true },
      { id: 123 },
      { id: "valid" },
    ]);
    expect(result).toEqual([{ id: "valid" }]);
  });

  it("returns empty for empty or non-array input", () => {
    expect(normalizeTags([])).toEqual([]);
    expect(normalizeTags(undefined)).toEqual([]);
    expect(normalizeTags(null)).toEqual([]);
  });
});
