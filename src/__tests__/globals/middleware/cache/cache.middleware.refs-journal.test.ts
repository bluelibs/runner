import { defineResource, defineTask } from "../../../../define";
import { genericError } from "../../../../errors";
import { middleware, resources, run } from "../../../../index";

const cacheJournalKeys = middleware.task.cache.journalKeys;
const retryJournalKeys = middleware.task.retry.journalKeys;

describe("cache middleware journal ref collection", () => {
  it("accumulates keyBuilder refs with refs added through the journal collector", async () => {
    let executions = 0;

    const cachedTask = defineTask<{ userId: string }>({
      id: "cache-journal-refs-accumulate-task",
      middleware: [
        middleware.task.cache.with({
          keyBuilder: (_taskId, input) => ({
            cacheKey: `user:${input.userId}`,
            refs: [`base:${input.userId}`],
          }),
        }),
      ],
      run: async (input, _deps, context) => {
        executions += 1;
        const cacheRefCollector = context!.journal.get(cacheJournalKeys.refs)!;

        cacheRefCollector.add([`late:${input.userId}`, `late:${input.userId}`]);
        return executions;
      },
    });

    const runtime = await run(
      defineResource<void>({
        id: "cache-journal-refs-accumulate-app",
        register: [resources.cache, cachedTask],
      }),
    );

    try {
      const cache = runtime.getResourceValue(resources.cache);

      await expect(runtime.runTask(cachedTask, { userId: "u1" })).resolves.toBe(
        1,
      );
      await expect(runtime.runTask(cachedTask, { userId: "u1" })).resolves.toBe(
        1,
      );

      await expect(cache.invalidateRefs("late:u1")).resolves.toBe(1);
      await expect(runtime.runTask(cachedTask, { userId: "u1" })).resolves.toBe(
        2,
      );

      await expect(cache.invalidateRefs("base:u1")).resolves.toBe(1);
      await expect(runtime.runTask(cachedTask, { userId: "u1" })).resolves.toBe(
        3,
      );
    } finally {
      await runtime.dispose();
    }
  });

  it("only exposes the journal collector during active cache misses", async () => {
    let uncachedCollectorValue: unknown;
    let cachedCollectorValue: unknown;

    const uncachedTask = defineTask({
      id: "cache-journal-refs-uncached",
      run: async (_input, _deps, context) => {
        uncachedCollectorValue = context!.journal.get(cacheJournalKeys.refs);
        return "uncached";
      },
    });

    const cachedTask = defineTask({
      id: "cache-journal-refs-cached",
      middleware: [middleware.task.cache.with({ ttl: 60_000 })],
      run: async (_input, _deps, context) => {
        cachedCollectorValue = context!.journal.get(cacheJournalKeys.refs);
        return "cached";
      },
    });

    const runtime = await run(
      defineResource<void>({
        id: "cache-journal-refs-availability-app",
        register: [resources.cache, uncachedTask, cachedTask],
      }),
    );

    try {
      await expect(runtime.runTask(uncachedTask)).resolves.toBe("uncached");
      await expect(runtime.runTask(cachedTask)).resolves.toBe("cached");
      await expect(runtime.runTask(cachedTask)).resolves.toBe("cached");

      expect(uncachedCollectorValue).toBeUndefined();
      expect(cachedCollectorValue).toBeDefined();
    } finally {
      await runtime.dispose();
    }
  });

  it("keeps only final successful retry-attempt refs when cache wraps retry", async () => {
    let runCount = 0;

    const task = defineTask({
      id: "cache-journal-refs-retry-task",
      middleware: [
        middleware.task.cache.with({
          keyBuilder: () => ({
            cacheKey: "retry-scope",
            refs: ["stable"],
          }),
        }),
        middleware.task.retry.with({
          retries: 1,
          delayStrategy: () => 0,
        }),
      ],
      run: async (_input, _deps, context) => {
        const attempt = context!.journal.get(retryJournalKeys.attempt) ?? 0;
        const cacheRefCollector = context!.journal.get(cacheJournalKeys.refs)!;

        runCount += 1;
        cacheRefCollector.add(`attempt:${attempt}`);

        if (attempt === 0) {
          throw genericError.new({ message: "retry me" });
        }

        return "ok";
      },
    });

    const runtime = await run(
      defineResource<void>({
        id: "cache-journal-refs-retry-app",
        register: [resources.cache, task],
      }),
    );

    try {
      const cache = runtime.getResourceValue(resources.cache);

      await expect(runtime.runTask(task)).resolves.toBe("ok");
      expect(runCount).toBe(2);
      await expect(cache.invalidateRefs("attempt:0")).resolves.toBe(0);
      await expect(cache.invalidateRefs("stable")).resolves.toBe(1);
      await expect(runtime.runTask(task)).resolves.toBe("ok");
      expect(runCount).toBe(4);
      await expect(cache.invalidateRefs("attempt:0")).resolves.toBe(0);
      await expect(cache.invalidateRefs("attempt:1")).resolves.toBe(1);
      await expect(runtime.runTask(task)).resolves.toBe("ok");
      expect(runCount).toBe(6);
    } finally {
      await runtime.dispose();
    }
  });

  it("keeps only final successful retry-attempt refs when retry wraps cache", async () => {
    let runCount = 0;

    const task = defineTask({
      id: "cache-journal-refs-retry-outside-task",
      middleware: [
        middleware.task.retry.with({
          retries: 1,
          delayStrategy: () => 0,
        }),
        middleware.task.cache.with({
          keyBuilder: () => ({
            cacheKey: "retry-outside-scope",
            refs: ["stable-outside"],
          }),
        }),
      ],
      run: async (_input, _deps, context) => {
        const attempt = context!.journal.get(retryJournalKeys.attempt) ?? 0;
        const cacheRefCollector = context!.journal.get(cacheJournalKeys.refs)!;

        runCount += 1;
        cacheRefCollector.add(`outer-attempt:${attempt}`);

        if (attempt === 0) {
          throw genericError.new({ message: "retry me again" });
        }

        return "ok";
      },
    });

    const runtime = await run(
      defineResource<void>({
        id: "cache-journal-refs-retry-outside-app",
        register: [resources.cache, task],
      }),
    );

    try {
      const cache = runtime.getResourceValue(resources.cache);

      await expect(runtime.runTask(task)).resolves.toBe("ok");
      expect(runCount).toBe(2);
      await expect(cache.invalidateRefs("outer-attempt:0")).resolves.toBe(0);
      await expect(cache.invalidateRefs("outer-attempt:1")).resolves.toBe(1);
      await expect(cache.invalidateRefs("stable-outside")).resolves.toBe(0);
    } finally {
      await runtime.dispose();
    }
  });

  it("isolates nested cached collectors while allowing forwarded plain tasks to contribute to the parent", async () => {
    let parentRuns = 0;
    let childCachedRuns = 0;
    let childPlainRuns = 0;

    const childCached = defineTask({
      id: "cache-journal-refs-child-cached",
      middleware: [
        middleware.task.cache.with({
          keyBuilder: () => "child-cached",
        }),
      ],
      run: async (_input, _deps, context) => {
        childCachedRuns += 1;
        context!.journal.get(cacheJournalKeys.refs)!.add("child");
        return "child";
      },
    });

    const childPlain = defineTask({
      id: "cache-journal-refs-child-plain",
      run: async (_input, _deps, context) => {
        childPlainRuns += 1;
        context!.journal.get(cacheJournalKeys.refs)!.add("parent-shared");
        return "plain";
      },
    });

    const parent = defineTask({
      id: "cache-journal-refs-parent",
      dependencies: { childCached, childPlain },
      middleware: [
        middleware.task.cache.with({
          keyBuilder: () => "parent",
        }),
      ],
      run: async (_input, { childCached, childPlain }, context) => {
        parentRuns += 1;
        context!.journal.get(cacheJournalKeys.refs)!.add("parent");
        await childPlain(undefined, { journal: context!.journal });
        await childCached(undefined, { journal: context!.journal });
        return "parent";
      },
    });

    const runtime = await run(
      defineResource<void>({
        id: "cache-journal-refs-nested-app",
        register: [resources.cache, childCached, childPlain, parent],
      }),
    );

    try {
      const cache = runtime.getResourceValue(resources.cache);

      await expect(runtime.runTask(parent)).resolves.toBe("parent");
      expect(parentRuns).toBe(1);
      expect(childPlainRuns).toBe(1);
      expect(childCachedRuns).toBe(1);

      await expect(cache.invalidateRefs("child")).resolves.toBe(1);
      await expect(runtime.runTask(parent)).resolves.toBe("parent");
      expect(parentRuns).toBe(1);
      expect(childPlainRuns).toBe(1);
      expect(childCachedRuns).toBe(1);

      await expect(runtime.runTask(childCached)).resolves.toBe("child");
      expect(childCachedRuns).toBe(2);

      await expect(cache.invalidateRefs("parent-shared")).resolves.toBe(1);
      await expect(runtime.runTask(parent)).resolves.toBe("parent");
      expect(parentRuns).toBe(2);
      expect(childPlainRuns).toBe(2);
      expect(childCachedRuns).toBe(2);
    } finally {
      await runtime.dispose();
    }
  });
});
