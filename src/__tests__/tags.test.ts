import {
  defineTag,
  defineTask,
  defineResource,
  defineEvent,
  defineMiddleware,
} from "../define";
import { run } from "../run";

describe("Configurable Tags", () => {
  describe("Tag Definition", () => {
    it("should create a tag with string id", () => {
      const performanceTag = defineTag<{ alertAboveMs: number }>({
        id: "performance.track",
      });

      expect(performanceTag.id).toBe("performance.track");
      expect(typeof performanceTag.with).toBe("function");
      expect(typeof performanceTag.extract).toBe("function");
    });

    it("should create a tag with symbol id", () => {
      const symbolId = Symbol("test.tag");
      const testTag = defineTag<{ value: string }>({ id: symbolId });

      expect(testTag.id).toBe(symbolId);
    });

    it("should create a tag without configuration", () => {
      const simpleTag = defineTag({ id: "simple.tag" });

      expect(simpleTag.id).toBe("simple.tag");
      expect(typeof simpleTag.with).toBe("function");
      expect(typeof simpleTag.extract).toBe("function");
    });
  });

  describe("Tag Configuration with .with()", () => {
    it("should create a configured tag instance", () => {
      const performanceTag = defineTag<{ alertAboveMs: number }>({
        id: "performance.track",
      });

      const configuredTag = performanceTag.with({ alertAboveMs: 200 });

      expect(configuredTag.id).toBe("performance.track");
      expect(configuredTag.config).toEqual({ alertAboveMs: 200 });
      expect(configuredTag.tag).toBe(performanceTag);
    });

    it("should allow multiple configurations of the same tag", () => {
      const cacheTag = defineTag<{ ttl: number }>({ id: "cache.config" });

      const shortCache = cacheTag.with({ ttl: 300 });
      const longCache = cacheTag.with({ ttl: 3600 });

      expect(shortCache.config.ttl).toBe(300);
      expect(longCache.config.ttl).toBe(3600);
      expect(shortCache.tag).toBe(cacheTag);
      expect(longCache.tag).toBe(cacheTag);
    });
  });

  describe("Tag Extraction with .extract()", () => {
    it("should extract configured tag from tags array", () => {
      const performanceTag = defineTag<{ alertAboveMs: number }>({
        id: "performance.track",
      });

      const tags = [
        "simple-string-tag",
        performanceTag.with({ alertAboveMs: 200 }),
        "another-string",
      ];

      const extracted = performanceTag.extract(tags);

      expect(extracted).not.toBeNull();
      expect(extracted?.id).toBe("performance.track");
      expect(extracted?.config).toEqual({ alertAboveMs: 200 });
    });

    it("should extract unconfigured tag from tags array", () => {
      const simpleTag = defineTag({ id: "simple.tag" });

      const tags = ["string-tag", simpleTag, "another-string"];

      const extracted = simpleTag.extract(tags);

      expect(extracted).not.toBeNull();
      expect(extracted?.id).toBe("simple.tag");
      expect(extracted?.config).toBeUndefined();
    });

    it("should return null if tag not found", () => {
      const performanceTag = defineTag<{ alertAboveMs: number }>({
        id: "performance.track",
      });

      const tags = ["string-tag", "another-string"];

      const extracted = performanceTag.extract(tags);

      expect(extracted).toBeNull();
    });

    it("should ignore string tags during extraction", () => {
      const performanceTag = defineTag<{ alertAboveMs: number }>({
        id: "performance.track",
      });

      const tags = [
        "performance.track", // This is a string, not the tag
        performanceTag.with({ alertAboveMs: 100 }),
      ];

      const extracted = performanceTag.extract(tags);

      expect(extracted).not.toBeNull();
      expect(extracted?.config).toEqual({ alertAboveMs: 100 });
    });

    it("should handle symbol ids correctly", () => {
      const symbolId = Symbol("test.tag");
      const testTag = defineTag<{ data: string }>({ id: symbolId });

      const tags = [testTag.with({ data: "test" })];

      const extracted = testTag.extract(tags);

      expect(extracted).not.toBeNull();
      expect(extracted?.id).toBe(symbolId);
      expect(extracted?.config).toEqual({ data: "test" });
    });

    it("should extract configured tag from a taggable object (task.definition)", () => {
      const performanceTag = defineTag<{ alertAboveMs: number }>({
        id: "performance.track",
      });

      const task = defineTask({
        id: "task.with.tags",
        meta: {
          tags: [performanceTag.with({ alertAboveMs: 123 })],
        },
        run: async () => "ok",
      });

      const extracted = performanceTag.extract(task);
      expect(extracted).not.toBeNull();
      expect(extracted?.config).toEqual({ alertAboveMs: 123 });
    });

    it("should return null when taggable has no tags", () => {
      const t = defineTag({ id: "x" });
      const task = defineTask({ id: "no.tags", run: async () => "ok" });
      expect(t.extract(task)).toBeNull();
    });

    it("should work with a simple taggable carrying meta.tags directly", () => {
      const t = defineTag<{ p: number }>({ id: "pp" });
      const taggable = { meta: { tags: [t.with({ p: 9 })] } } as any;
      const extracted = t.extract(taggable);
      expect(extracted?.config).toEqual({ p: 9 });
    });
  });

  describe("Integration with Tasks", () => {
    it("should work with task metadata", () => {
      const performanceTag = defineTag<{ alertAboveMs: number }>({
        id: "performance.track",
      });

      const testTask = defineTask({
        id: "test.task",
        meta: {
          tags: [
            "api",
            performanceTag.with({ alertAboveMs: 200 }),
            "important",
          ],
        },
        run: async () => {
          return "success";
        },
      });

      expect(testTask.meta?.tags).toHaveLength(3);
      expect(testTask.meta?.tags?.[0]).toBe("api");
      expect(testTask.meta?.tags?.[2]).toBe("important");

      const extracted = performanceTag.extract(testTask.meta?.tags || []);
      expect(extracted).not.toBeNull();
      expect(extracted?.config).toEqual({ alertAboveMs: 200 });
    });

    it("should work with middleware checking tags", async () => {
      const performanceTag = defineTag<{ alertAboveMs: number }>({
        id: "performance.track",
      });

      const middlewareExecutions: Array<{ taskId: string; config: any }> = [];

      const performanceMiddleware = defineMiddleware({
        id: "performance.middleware",
        run: async ({ task, next }) => {
          if (task?.definition.meta?.tags) {
            const extracted = performanceTag.extract(task.definition.meta.tags);
            if (extracted) {
              middlewareExecutions.push({
                taskId: task.definition.id as string,
                config: extracted.config,
              });
            }
          }
          return next(task?.input);
        },
      });

      const fastTask = defineTask({
        id: "fast.task",
        meta: {
          tags: [performanceTag.with({ alertAboveMs: 100 })],
        },
        run: async () => "fast",
      });

      const slowTask = defineTask({
        id: "slow.task",
        meta: {
          tags: [performanceTag.with({ alertAboveMs: 500 })],
        },
        run: async () => "slow",
      });

      const normalTask = defineTask({
        id: "normal.task",
        meta: {
          tags: ["just-a-string"],
        },
        run: async () => "normal",
      });

      const app = defineResource({
        id: "test.app",
        register: [
          fastTask,
          slowTask,
          normalTask,
          performanceMiddleware.everywhere(),
        ],
        dependencies: { fastTask, slowTask, normalTask },
        init: async (_, { fastTask, slowTask, normalTask }) => {
          await fastTask();
          await slowTask();
          await normalTask();
          return "done";
        },
      });

      const { dispose } = await run(app);
      await dispose();

      expect(middlewareExecutions).toHaveLength(2);
      expect(middlewareExecutions).toEqual([
        { taskId: "fast.task", config: { alertAboveMs: 100 } },
        { taskId: "slow.task", config: { alertAboveMs: 500 } },
      ]);
    });
  });

  describe("Integration with Resources", () => {
    it("should work with resource metadata", () => {
      const dbTag = defineTag<{ connectionTimeout: number }>({
        id: "db.config",
      });

      const database = defineResource({
        id: "database",
        meta: {
          tags: ["database", dbTag.with({ connectionTimeout: 5000 })],
        },
        init: async () => ({ query: () => "result" }),
      });

      expect(database.meta?.tags).toHaveLength(2);
      const extracted = dbTag.extract(database.meta?.tags || []);
      expect(extracted?.config).toEqual({ connectionTimeout: 5000 });
    });
  });

  describe("Integration with Events", () => {
    it("should work with event metadata", () => {
      const auditTag = defineTag<{ sensitive: boolean }>({
        id: "audit.config",
      });

      const userEvent = defineEvent<{ userId: string }>({
        id: "user.created",
        meta: {
          tags: ["user-event", auditTag.with({ sensitive: true })],
        },
      });

      expect(userEvent.meta?.tags).toHaveLength(2);
      const extracted = auditTag.extract(userEvent.meta?.tags || []);
      expect(extracted?.config).toEqual({ sensitive: true });
    });
  });

  describe("Integration with Middleware", () => {
    it("should work with middleware metadata", () => {
      const rateLimitTag = defineTag<{ requestsPerMinute: number }>({
        id: "rate-limit",
      });

      const rateLimitMiddleware = defineMiddleware({
        id: "rate.limit.middleware",
        meta: {
          tags: ["security", rateLimitTag.with({ requestsPerMinute: 60 })],
        },
        run: async ({ next, task }) => {
          return next(task?.input);
        },
      });

      expect(rateLimitMiddleware.meta?.tags).toHaveLength(2);
      const extracted = rateLimitTag.extract(
        rateLimitMiddleware.meta?.tags || []
      );
      expect(extracted?.config).toEqual({ requestsPerMinute: 60 });
    });
  });

  describe("Backward Compatibility", () => {
    it("should work with existing string tags", () => {
      const task = defineTask({
        id: "legacy.task",
        meta: {
          tags: ["api", "legacy", "important"],
        },
        run: async () => "success",
      });

      // String tags should still work
      expect(task.meta?.tags).toEqual(["api", "legacy", "important"]);

      // New tags should not interfere with string tags
      const performanceTag = defineTag<{ alertAboveMs: number }>({
        id: "performance.track",
      });

      const extracted = performanceTag.extract(task.meta?.tags || []);
      expect(extracted).toBeNull(); // Should not find the tag
    });

    it("should allow mixing string tags and configurable tags", () => {
      const performanceTag = defineTag<{ alertAboveMs: number }>({
        id: "performance.track",
      });

      const task = defineTask({
        id: "mixed.task",
        meta: {
          tags: [
            "api", // string tag
            performanceTag.with({ alertAboveMs: 200 }), // configurable tag
            "important", // string tag
          ],
        },
        run: async () => "success",
      });

      expect(task.meta?.tags).toHaveLength(3);
      expect(task.meta?.tags?.[0]).toBe("api");
      expect(task.meta?.tags?.[2]).toBe("important");

      const extracted = performanceTag.extract(task.meta?.tags || []);
      expect(extracted?.config).toEqual({ alertAboveMs: 200 });
    });
  });

  describe("Edge Cases", () => {
    it("should handle null/undefined config", () => {
      const optionalTag = defineTag<{ value?: string }>({
        id: "optional.config",
      });

      const configuredTag = optionalTag.with({});
      expect(configuredTag.config).toEqual({});

      const extracted = optionalTag.extract([configuredTag]);
      expect(extracted?.config).toEqual({});
    });
  });
});
