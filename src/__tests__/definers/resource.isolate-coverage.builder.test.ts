import { defineResource, defineTag, defineTask } from "../../define";
import { run } from "../../run";
import { scope, subtreeOf } from "../../public";
import {
  isolateInvalidEntryError,
  isolateUnknownTargetError,
  isolateInvalidExportsError,
  visibilityViolationError,
} from "../../errors";

const POLICY_INVALID_ENTRY_ID = isolateInvalidEntryError.id;
const POLICY_UNKNOWN_TARGET_ID = isolateUnknownTargetError.id;
const EXPORTS_INVALID_ID = isolateInvalidExportsError.id;

async function expectRunnerErrorId(
  promise: Promise<unknown>,
  errorId: string,
): Promise<unknown> {
  try {
    await promise;
    throw new Error(`Expected error id "${errorId}"`);
  } catch (error) {
    const candidate = error as { id?: string };
    expect(candidate.id).toBe(errorId);
    return error;
  }
}

describe("isolation entry normalization coverage", () => {
  describe("deny/only entry validation", () => {
    it("throws isolateInvalidEntryError for bare strings in deny array", async () => {
      const task = defineTask({
        id: "coverage-isolate-deny-string-task",
        run: async () => 42,
      });
      const resource = defineResource({
        id: "coverage-isolate-deny-string-resource",
        isolate: { deny: ["task-id-string" as never] },
        register: [task],
      });

      await expectRunnerErrorId(run(resource), POLICY_INVALID_ENTRY_ID);
    });

    it("throws isolateUnknownTargetError for scope with non-existent subtree resourceId", async () => {
      const task = defineTask({
        id: "coverage-isolate-unknown-subtree-task",
        run: async () => 42,
      });
      const unknownSubtree = subtreeOf({
        id: "non-existent-resource",
      } as never);

      const resource = defineResource({
        id: "coverage-isolate-unknown-subtree-resource",
        isolate: { deny: [scope(unknownSubtree)] },
        register: [task],
      });

      await expectRunnerErrorId(run(resource), POLICY_UNKNOWN_TARGET_ID);
    });

    it("throws isolateInvalidEntryError for scope with empty string target", async () => {
      const task = defineTask({
        id: "coverage-isolate-empty-scope-target-task",
        run: async () => 42,
      });
      const resource = defineResource({
        id: "coverage-isolate-empty-scope-target-resource",
        isolate: { deny: [scope("" as unknown as never)] },
        register: [task],
      });

      await expectRunnerErrorId(run(resource), POLICY_INVALID_ENTRY_ID);
    });

    it("throws isolateUnknownTargetError for unknown scope string selectors", async () => {
      const task = defineTask({
        id: "coverage-isolate-zero-match-wildcard-task",
        run: async () => 42,
      });
      const resource = defineResource({
        id: "coverage-isolate-zero-match-wildcard-resource",
        isolate: { deny: [scope("no.such.pattern.*" as unknown as never)] },
        register: [task],
      });

      await expectRunnerErrorId(run(resource), POLICY_UNKNOWN_TARGET_ID);
    });
  });

  describe("exports entry validation", () => {
    it("throws isolateInvalidExportsError for empty string in exports", async () => {
      const task = defineTask({
        id: "coverage-isolate-empty-export-task",
        run: async () => 42,
      });
      const resource = defineResource({
        id: "coverage-isolate-empty-export-resource",
        isolate: { exports: ["" as never] },
        register: [task],
      });

      await expectRunnerErrorId(run(resource), EXPORTS_INVALID_ID);
    });

    it("throws isolateInvalidExportsError for wildcard string exports", async () => {
      const task = defineTask({
        id: "coverage-isolate-zero-export-match-task",
        run: async () => 42,
      });
      const resource = defineResource({
        id: "coverage-isolate-zero-export-match-resource",
        isolate: { exports: ["no.such.export.pattern.*"] as any },
        register: [task],
      });

      await expectRunnerErrorId(run(resource), EXPORTS_INVALID_ID);
    });

    it("allows valid exports without throwing", async () => {
      const task = defineTask({
        id: "coverage-isolate-valid-export-task",
        run: async () => 42,
      });
      const resource = defineResource({
        id: "coverage-isolate-valid-export-resource",
        isolate: { exports: [task] },
        register: [task],
      });

      const runtime = await run(resource);
      await expect(runtime.runTask(task)).resolves.toBe(42);
      await runtime.dispose();
    });
  });

  describe("tag handling in isolation", () => {
    it("allows tags in deny", async () => {
      const tag = defineTag({ id: "coverage-isolate-tag-deny-tag" });
      const taggedTask = defineTask({
        id: "coverage-isolate-tag-deny-tagged-task",
        run: async () => 42,
        tags: [tag],
      });
      const consumerTask = defineTask({
        id: "coverage-isolate-tag-deny-consumer-task",
        dependencies: { taggedTask },
        run: async (_input, deps) => deps.taggedTask(),
      });

      const resource = defineResource({
        id: "coverage-isolate-tag-deny-resource",
        isolate: { deny: [scope(tag)] },
        register: [tag, taggedTask, consumerTask],
      });

      let runtime: Awaited<ReturnType<typeof run>> | undefined;
      await expectRunnerErrorId(
        (async () => {
          runtime = await run(resource);
          return runtime.runTask(consumerTask);
        })(),
        "runner.errors.isolationViolation",
      );
      await runtime?.dispose();
    });

    it("accepts tags in exports without making tagged tasks public", async () => {
      const tag = defineTag({ id: "coverage-isolate-tag-export-tag" });
      const taggedTask = defineTask({
        id: "coverage-isolate-tag-export-tagged-task",
        run: async () => 100,
        tags: [tag],
      });

      const child = defineResource({
        id: "coverage-isolate-tag-export-child",
        isolate: { exports: [tag] },
        register: [tag, taggedTask],
      });

      const root = defineResource({
        id: "coverage-isolate-tag-export-root",
        register: [child],
        dependencies: { taggedTask },
        async init(_config, deps) {
          return deps.taggedTask();
        },
      });

      await expectRunnerErrorId(run(root), visibilityViolationError.id);
    });
  });

  describe("non-tag definitions in scope", () => {
    it("scope(taskDef) covers the non-tag branch in addTarget", async () => {
      const deniedTask = defineTask({
        id: "coverage-isolate-scope-task-denied",
        run: async () => 42,
      });
      const allowedTask = defineTask({
        id: "coverage-isolate-scope-task-allowed",
        run: async () => 100,
      });
      const consumerTask = defineTask({
        id: "coverage-isolate-scope-task-consumer",
        dependencies: { deniedTask },
        run: async (_input, deps) => deps.deniedTask(),
      });

      const resource = defineResource({
        id: "coverage-isolate-scope-task-resource",
        // Use scope() with a task definition (not a tag)
        isolate: { deny: [scope(deniedTask)] },
        register: [deniedTask, allowedTask, consumerTask],
      });

      let runtime: Awaited<ReturnType<typeof run>> | undefined;
      await expectRunnerErrorId(
        (async () => {
          runtime = await run(resource);
          return runtime.runTask(consumerTask);
        })(),
        "runner.errors.isolationViolation",
      );
      await runtime?.dispose();
    });

    it("scope([taskDef, eventDef]) covers multiple non-tag definitions", async () => {
      const deniedTask = defineTask({
        id: "coverage-isolate-scope-multi-denied-task",
        run: async () => 42,
      });
      const allowedTask = defineTask({
        id: "coverage-isolate-scope-multi-allowed",
        run: async () => 100,
      });

      const resource = defineResource({
        id: "coverage-isolate-scope-multi-resource",
        // Use scope() with an array of non-tag definitions
        isolate: { only: [scope([deniedTask, allowedTask])] },
        register: [deniedTask, allowedTask],
      });

      const runtime = await run(resource);
      await expect(runtime.runTask(deniedTask)).resolves.toBe(42);
      await expect(runtime.runTask(allowedTask)).resolves.toBe(100);
      await runtime.dispose();
    });
  });
});
