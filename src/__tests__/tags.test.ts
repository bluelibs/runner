import {
  defineTag,
  defineTask,
  defineResource,
  defineEvent,
  defineTaskMiddleware,
} from "../define";
import { run } from "../run";
import { TagType } from "../defs";
import { globalResources } from "../globals/globalResources";
import { globalTags } from "../globals/globalTags";

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

    it("should create a tag without configuration", () => {
      const simpleTag = defineTag({ id: "simple.tag" });

      expect(simpleTag.id).toBe("simple.tag");
      expect(typeof simpleTag.with).toBe("function");
      expect(typeof simpleTag.extract).toBe("function");
    });

    it("should work with validation schema", () => {
      const simpleTag = defineTag<{ value: string }>({
        id: "simple.tag",
        configSchema: {
          parse: (input) => {
            throw new Error("Validation Error");
          },
        },
      });

      expect(() => simpleTag.with({ value: 123 as unknown as string })).toThrow(
        "Validation Error",
      );
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
    });

    it("should allow multiple configurations of the same tag", () => {
      const cacheTag = defineTag<{ ttl: number }>({ id: "cache.config" });

      const shortCache = cacheTag.with({ ttl: 300 });
      const longCache = cacheTag.with({ ttl: 3600 });

      expect(shortCache.config.ttl).toBe(300);
      expect(longCache.config.ttl).toBe(3600);
    });
  });

  describe("Tag Extraction with .extract()", () => {
    it("should extract configured tag from tags array", () => {
      const performanceTag = defineTag<{ alertAboveMs: number }>({
        id: "performance.track",
      });

      const tags = [
        performanceTag.with({ alertAboveMs: 200 }),
      ] satisfies TagType[];

      const extracted = performanceTag.extract(tags);

      expect(extracted).not.toBeNull();
      expect(extracted).toEqual({ alertAboveMs: 200 });
    });

    it("should extract unconfigured tag from tags array", () => {
      const simpleTag = defineTag({ id: "simple.tag" });

      const tags = [simpleTag] satisfies TagType[];

      const extracted = simpleTag.extract(tags);

      expect(extracted).not.toBeNull();
      expect(extracted).toBeUndefined();
    });

    it("should properly extend the tag data", () => {
      const simpleTag = defineTag<{ value: number; other?: string }>({
        id: "simple.tag",
        config: { value: 2, other: "ss" },
      });
      const simpleTag2 = simpleTag.with({ value: 123 });

      expect(simpleTag2.config).toEqual({ value: 123, other: "ss" });
    });

    it("should extract config and check existense when tag is present", () => {
      const performanceTag = defineTag<{ alertAboveMs: number }>({
        id: "performance.track",
      });
      const nonExistentTag = defineTag({ id: "non.existent.tag" });

      const tags = [
        performanceTag.with({ alertAboveMs: 100 }),
      ] satisfies TagType[];

      const exists = performanceTag.exists(tags);
      expect(exists).toBe(true);

      const exists2 = nonExistentTag.exists(tags);
      expect(exists2).toBe(false);

      const extracted = performanceTag.extract(tags);

      expect(extracted).not.toBeNull();
      expect(extracted).toEqual({ alertAboveMs: 100 });
    });

    it("should extract configured tag from a taggable object (task.definition)", () => {
      const performanceTag = defineTag<{ alertAboveMs: number }>({
        id: "performance.track",
      });

      const task = defineTask({
        id: "task.with.tags",
        tags: [performanceTag.with({ alertAboveMs: 123 })],
        run: async () => "ok",
      });

      const extracted = performanceTag.extract(task);
      expect(extracted).not.toBeNull();
      expect(extracted).toEqual({ alertAboveMs: 123 });
    });

    it("should return null when taggable has no tags", () => {
      const t = defineTag({ id: "x" });
      const task = defineTask({ id: "no.tags", run: async () => "ok" });
      expect(t.extract(task)).toBeUndefined();
    });

    it("should work with a simple taggable carrying tags at root level", () => {
      const t = defineTag<{ p: number }>({ id: "pp" });
      const taggable = { tags: [t.with({ p: 9 })] } as any;
      const extracted = t.extract(taggable);
      expect(extracted).toEqual({ p: 9 });
    });
  });

  describe("Integration with Tasks", () => {
    it("should work with task tags", () => {
      const performanceTag = defineTag<{ alertAboveMs: number }>({
        id: "performance.track",
      });

      const testTask = defineTask({
        id: "test.task",
        tags: [performanceTag.with({ alertAboveMs: 200 })],
        run: async () => {
          return "success";
        },
      });

      expect(testTask.tags).toHaveLength(1);

      const extracted = performanceTag.extract(testTask);
      expect(extracted).not.toBeNull();
      expect(extracted).toEqual({ alertAboveMs: 200 });
    });

    it("should work with middleware checking tags", async () => {
      const performanceTag = defineTag<{ alertAboveMs: number }>({
        id: "performance.track",
      });

      const middlewareExecutions: Array<{ taskId: string; config: any }> = [];

      const performanceMiddleware = defineTaskMiddleware({
        id: "performance.middleware",
        everywhere: true,
        run: async ({ task, next }) => {
          if (task?.definition.tags) {
            const extracted = performanceTag.extract(task.definition.tags);
            if (extracted) {
              middlewareExecutions.push({
                taskId: task.definition.id as string,
                config: extracted,
              });
            }
          }
          return next(task?.input);
        },
      });

      const fastTask = defineTask({
        id: "fast.task",
        tags: [performanceTag.with({ alertAboveMs: 100 })],
        run: async () => "fast",
      });

      const slowTask = defineTask({
        id: "slow.task",
        tags: [performanceTag.with({ alertAboveMs: 500 })],
        run: async () => "slow",
      });

      const app = defineResource({
        id: "test.app",
        register: [fastTask, slowTask, performanceMiddleware, performanceTag],
        dependencies: { fastTask, slowTask },
        init: async (_, { fastTask, slowTask }) => {
          await fastTask();
          await slowTask();
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
        tags: [dbTag.with({ connectionTimeout: 5000 })],
        init: async () => ({ query: () => "result" }),
      });

      expect(database.tags).toHaveLength(1);
      const extracted = dbTag.extract(database.tags);
      expect(extracted).toEqual({ connectionTimeout: 5000 });
    });
  });

  describe("Integration with Events", () => {
    it("should work with event metadata", () => {
      const auditTag = defineTag<{ sensitive: boolean }>({
        id: "audit.config",
      });

      const userEvent = defineEvent<{ userId: string }>({
        id: "user.created",
        tags: [auditTag.with({ sensitive: true })],
      });

      expect(userEvent.tags).toHaveLength(1);
      const extracted = auditTag.extract(userEvent.tags);
      expect(extracted).toEqual({ sensitive: true });
    });
  });

  describe("Integration with Middleware", () => {
    it("should work with middleware metadata", () => {
      const rateLimitTag = defineTag<{ requestsPerMinute: number }>({
        id: "rate-limit",
      });

      const rateLimitMiddleware = defineTaskMiddleware({
        id: "rate.limit.middleware",
        tags: [rateLimitTag.with({ requestsPerMinute: 60 })],
        run: async ({ next, task }) => {
          return next(task?.input);
        },
      });

      expect(rateLimitMiddleware.tags).toHaveLength(1);
      const extracted = rateLimitTag.extract(rateLimitMiddleware.tags);
      expect(extracted).toEqual({ requestsPerMinute: 60 });
    });
  });

  // Backward compatibility with string tags has been removed.

  describe("Integration with Store", () => {
    it("should work with full run() integration and arrive in store", async () => {
      const tag = defineTag({ id: "test.tag" });
      const tag2 = defineTag({ id: "test.tag2" });
      const resource = defineResource({
        id: "test.resource",
        register: [tag, tag2],
        tags: [tag, tag2],
      });

      const result = await run(resource);
      const store = result.getResourceValue(globalResources.store);
      const tags = Array.from(store.tags.values());
      expect(tags).toHaveLength(Object.values(globalTags).length + 2);
      expect(tags).toContain(tag);
      expect(tags).toContain(tag2);
    });
  });
  it("should throw an exception if you are using an unregistered tag", async () => {
    const tag = defineTag({ id: "test.tag" });
    const resource = defineResource({
      id: "test.resource",
      tags: [tag],
    });
    await expect(run(resource)).rejects.toThrow(
      'Tag "test.tag" not registered',
    );
  });
  describe("Edge Cases", () => {
    it("should handle null/undefined config", () => {
      const optionalTag = defineTag<{ value?: string }>({
        id: "optional.config",
      });

      const configuredTag = optionalTag.with({});
      expect(configuredTag.config).toEqual({});

      const extracted = optionalTag.extract([configuredTag]);
      expect(extracted).toEqual({});
    });
  });
});
