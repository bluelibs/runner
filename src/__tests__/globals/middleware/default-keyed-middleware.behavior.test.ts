import { defineResource, defineTask } from "../../../define";
import {
  type CacheProvider,
  cacheMiddleware,
  cacheResource,
} from "../../../globals/middleware/cache/middleware";
import { rateLimitTaskMiddleware } from "../../../globals/middleware/rateLimit.middleware";
import {
  debounceTaskMiddleware,
  throttleTaskMiddleware,
} from "../../../globals/middleware/temporal.middleware";
import { withSiblingTaskCollisionRuntime } from "./keyedMiddlewareCollision.shared";

describe("default keyed middleware behavior", () => {
  it("keeps shared rate-limit state isolated by full task lineage across sibling resources", async () => {
    const sharedRateLimit = rateLimitTaskMiddleware.with({
      windowMs: 1_000,
      max: 1,
    });

    await withSiblingTaskCollisionRuntime({
      appId: "app-rate-limit-lineage",
      createTask: (scope) =>
        defineTask({
          id: "sync",
          middleware: [sharedRateLimit],
          run: async (input: string) => `${scope}:${input}`,
        }),
      test: async ({ runtime, taskIds }) => {
        await expect(runtime.runTask(taskIds.billing, "same")).resolves.toBe(
          "billing:same",
        );
        await expect(runtime.runTask(taskIds.crm, "same")).resolves.toBe(
          "crm:same",
        );
        await expect(runtime.runTask(taskIds.billing, "same")).rejects.toThrow(
          /rate limit exceeded/i,
        );
        await expect(runtime.runTask(taskIds.crm, "same")).rejects.toThrow(
          /rate limit exceeded/i,
        );
      },
    });
  });

  it("keeps shared cache middleware task-scoped across sibling resources with the same local id", async () => {
    const sharedCache = cacheMiddleware.with({ ttl: 60_000 });
    const runCounts = { billing: 0, crm: 0 };

    await withSiblingTaskCollisionRuntime({
      appId: "app-cache-lineage",
      register: [cacheResource],
      createTask: (scope) =>
        defineTask({
          id: "sync",
          middleware: [sharedCache],
          run: async (input: string) =>
            `${scope}:${++runCounts[scope]}:${input}`,
        }),
      test: async ({ runtime, taskIds }) => {
        await expect(runtime.runTask(taskIds.billing, "same")).resolves.toBe(
          "billing:1:same",
        );
        await expect(runtime.runTask(taskIds.crm, "same")).resolves.toBe(
          "crm:1:same",
        );
        await expect(runtime.runTask(taskIds.billing, "same")).resolves.toBe(
          "billing:1:same",
        );
        await expect(runtime.runTask(taskIds.crm, "same")).resolves.toBe(
          "crm:1:same",
        );

        const cache = runtime.getResourceValue(cacheResource);
        expect(cache.map.has(taskIds.billing)).toBe(true);
        expect(cache.map.has(taskIds.crm)).toBe(true);
      },
    });

    expect(runCounts).toEqual({ billing: 1, crm: 1 });
  });

  it("keeps cache invalidation targets and transient providers isolated by canonical task lineage", async () => {
    const createCalls: string[] = [];
    const invalidationCalls: Array<{
      refs: readonly string[];
      taskId: string;
    }> = [];
    const sharedCache = cacheMiddleware.with({
      keyBuilder: (taskId, input: { userId: string }) => ({
        cacheKey: `${taskId}:user:${input.userId}`,
        refs: [`user:${input.userId}`],
      }),
    });
    const customProvider = defineResource({
      id: "cache-lineage-provider",
      init:
        async (): Promise<CacheProvider> =>
        async ({ taskId }) => {
          createCalls.push(taskId);
          return {
            get: async () => undefined,
            set: async () => undefined,
            clear: async () => undefined,
            invalidateKeys: async () => 1,
            invalidateRefs: async (refs) => {
              invalidationCalls.push({ refs, taskId });
              return 1;
            },
          };
        },
    });

    await withSiblingTaskCollisionRuntime({
      appId: "app-cache-invalidation-lineage",
      register: [cacheResource.with({ provider: customProvider })],
      createTask: () =>
        defineTask({
          id: "sync",
          middleware: [sharedCache],
          run: async () => "never-called",
        }),
      test: async ({ runtime, taskIds }) => {
        const cache = runtime.getResourceValue(cacheResource);

        await expect(cache.invalidateRefs("user:u1")).resolves.toBe(2);
        await expect(cache.invalidateRefs("user:u1")).resolves.toBe(2);

        expect(createCalls).toEqual([taskIds.billing, taskIds.crm]);
        expect(invalidationCalls).toEqual([
          { refs: ["user:u1"], taskId: taskIds.billing },
          { refs: ["user:u1"], taskId: taskIds.crm },
          { refs: ["user:u1"], taskId: taskIds.billing },
          { refs: ["user:u1"], taskId: taskIds.crm },
        ]);
      },
    });
  });

  it("keeps shared debounce state isolated by full task lineage across sibling resources", async () => {
    jest.useFakeTimers();
    const sharedDebounce = debounceTaskMiddleware.with({ ms: 50 });
    const runCounts = { billing: 0, crm: 0 };

    try {
      await withSiblingTaskCollisionRuntime({
        appId: "app-debounce-lineage",
        createTask: (scope) =>
          defineTask({
            id: "sync",
            middleware: [sharedDebounce],
            run: async (input: string) =>
              `${scope}:${++runCounts[scope]}:${input}`,
          }),
        test: async ({ runtime, taskIds }) => {
          const pending = Promise.all([
            runtime.runTask(taskIds.billing, "same"),
            runtime.runTask(taskIds.crm, "same"),
          ]);

          jest.advanceTimersByTime(50);
          await Promise.resolve();

          await expect(pending).resolves.toEqual([
            "billing:1:same",
            "crm:1:same",
          ]);
        },
      });
    } finally {
      jest.useRealTimers();
    }

    expect(runCounts).toEqual({ billing: 1, crm: 1 });
  });

  it("keeps shared throttle state isolated by full task lineage across sibling resources", async () => {
    jest.useFakeTimers();
    const sharedThrottle = throttleTaskMiddleware.with({ ms: 50 });
    const runCounts = { billing: 0, crm: 0 };

    try {
      await withSiblingTaskCollisionRuntime({
        appId: "app-throttle-lineage",
        createTask: (scope) =>
          defineTask({
            id: "sync",
            middleware: [sharedThrottle],
            run: async (input: string) =>
              `${scope}:${++runCounts[scope]}:${input}`,
          }),
        test: async ({ runtime, taskIds }) => {
          const pending = Promise.all([
            runtime.runTask(taskIds.billing, "first"),
            runtime.runTask(taskIds.crm, "first"),
            runtime.runTask(taskIds.billing, "second"),
            runtime.runTask(taskIds.crm, "second"),
          ]);

          jest.advanceTimersByTime(50);
          await Promise.resolve();

          await expect(pending).resolves.toEqual([
            "billing:1:first",
            "crm:1:first",
            "billing:2:second",
            "crm:2:second",
          ]);
        },
      });
    } finally {
      jest.useRealTimers();
    }

    expect(runCounts).toEqual({ billing: 2, crm: 2 });
  });
});
