import { defineTask, defineResource } from "../../define";
import { run } from "../../run";
import { r } from "../../public";

describe("run.exports-visibility", () => {
  describe("backward compatibility", () => {
    it("allows all dependencies when no exports are declared", async () => {
      const innerTask = defineTask({
        id: "exports.compat.inner",
        run: async () => "inner-value",
      });

      const child = defineResource({
        id: "exports.compat.child",
        register: [innerTask],
      });

      const root = defineResource({
        id: "exports.compat.root",
        register: [child],
        dependencies: { innerTask },
        async init(_, deps) {
          return await deps.innerTask();
        },
      });

      const result = await run(root);
      expect(result.value).toBe("inner-value");
      await result.dispose();
    });
  });

  describe("basic isolation", () => {
    it("allows access to exported tasks", async () => {
      const publicTask = defineTask({
        id: "exports.basic.public",
        run: async () => "public",
      });
      const privateTask = defineTask({
        id: "exports.basic.private",
        run: async () => "private",
      });

      const child = defineResource({
        id: "exports.basic.child",
        register: [publicTask, privateTask],
        exports: [publicTask],
      });

      const root = defineResource({
        id: "exports.basic.root",
        register: [child],
        dependencies: { publicTask },
        async init(_, deps) {
          return await deps.publicTask();
        },
      });

      const result = await run(root);
      expect(result.value).toBe("public");
      await result.dispose();
    });

    it("blocks access to non-exported tasks", async () => {
      const publicTask = defineTask({
        id: "exports.block.public",
        run: async () => "public",
      });
      const privateTask = defineTask({
        id: "exports.block.private",
        run: async () => "private",
      });

      const child = defineResource({
        id: "exports.block.child",
        register: [publicTask, privateTask],
        exports: [publicTask],
      });

      const root = defineResource({
        id: "exports.block.root",
        register: [child],
        dependencies: { privateTask },
      });

      await expect(run(root)).rejects.toThrow(
        /exports\.block\.private.*internal.*exports\.block\.child/,
      );
    });

    it("returns a visibility error with actionable remediation for private dependencies", async () => {
      expect.assertions(7);

      const publicTask = defineTask({
        id: "exports.error.public",
        run: async () => "public",
      });
      const privateTask = defineTask({
        id: "exports.error.private",
        run: async () => "private",
      });

      const child = defineResource({
        id: "exports.error.child",
        register: [publicTask, privateTask],
        exports: [publicTask],
      });

      const root = defineResource({
        id: "exports.error.root",
        register: [child],
        dependencies: { privateTask },
      });

      try {
        await run(root);
        fail("Expected run() to fail with visibility violation");
      } catch (e: any) {
        expect(e.id).toBe("runner.errors.visibilityViolation");
        expect(e.message).toContain(
          'Item "exports.error.private" is internal to resource "exports.error.child"',
        );
        expect(e.message).toContain(
          'cannot be referenced by Resource "exports.error.root"',
        );
        expect(e.message).toContain("Remediation:");
        expect(e.remediation).toContain(
          'Resource "exports.error.child" exports: [exports.error.public].',
        );
        expect(e.remediation).toContain(
          'Either add "exports.error.private" to exports.error.child\'s .exports([...])',
        );
        expect(e.remediation).toContain(
          "or restructure to use an exported item instead.",
        );
      }
    });

    it("blocks access to non-exported resources", async () => {
      const innerResource = defineResource({
        id: "exports.block-res.inner",
        async init() {
          return "inner";
        },
      });

      const child = defineResource({
        id: "exports.block-res.child",
        register: [innerResource],
        exports: [],
      });

      const root = defineResource({
        id: "exports.block-res.root",
        register: [child],
        dependencies: { innerResource },
      });

      await expect(run(root)).rejects.toThrow(
        /exports\.block-res\.inner.*internal.*exports\.block-res\.child/,
      );
    });
  });

  describe("subtree and transitive behavior", () => {
    it("allows a resource to depend on its own non-exported registered task", async () => {
      const internalTask = defineTask({
        id: "exports.owner-scope.internal-task",
        run: async () => "internal-value",
      });

      const child = defineResource({
        id: "exports.owner-scope.child",
        register: [internalTask],
        exports: [],
        dependencies: { internalTask },
        async init(_, deps) {
          return await deps.internalTask();
        },
      });

      const root = defineResource({
        id: "exports.owner-scope.root",
        register: [child],
        dependencies: { child },
        async init(_, deps) {
          return deps.child;
        },
      });

      const result = await run(root);
      expect(result.value).toBe("internal-value");
      await result.dispose();
    });

    it("allows internal subtree access even when item is not exported", async () => {
      const sharedTask = defineTask({
        id: "exports.subtree.shared",
        run: async () => "shared-value",
      });
      const internalConsumer = defineTask({
        id: "exports.subtree.consumer",
        dependencies: { sharedTask },
        run: async (_, deps) => deps.sharedTask(),
      });

      const child = defineResource({
        id: "exports.subtree.child",
        register: [sharedTask, internalConsumer],
        exports: [internalConsumer],
      });

      const root = defineResource({
        id: "exports.subtree.root",
        register: [child],
        dependencies: { internalConsumer },
        async init(_, deps) {
          return await deps.internalConsumer();
        },
      });

      const result = await run(root);
      expect(result.value).toBe("shared-value");
      await result.dispose();
    });

    it("supports transitive visibility via exported resources", async () => {
      const deepTask = defineTask({
        id: "exports.transitive-resource.deep",
        run: async () => "deep-value",
      });

      const middle = defineResource({
        id: "exports.transitive-resource.middle",
        register: [deepTask],
        exports: [deepTask],
      });

      const outer = defineResource({
        id: "exports.transitive-resource.outer",
        register: [middle],
        exports: [middle],
      });

      const root = defineResource({
        id: "exports.transitive-resource.root",
        register: [outer],
        dependencies: { deepTask },
        async init(_, deps) {
          return await deps.deepTask();
        },
      });

      const result = await run(root);
      expect(result.value).toBe("deep-value");
      await result.dispose();
    });

    it("blocks when parent does not re-export child resource", async () => {
      const deepTask = defineTask({
        id: "exports.no-reexport.deep",
        run: async () => "deep",
      });

      const middle = defineResource({
        id: "exports.no-reexport.middle",
        register: [deepTask],
        exports: [deepTask],
      });

      const outer = defineResource({
        id: "exports.no-reexport.outer",
        register: [middle],
        exports: [],
      });

      const root = defineResource({
        id: "exports.no-reexport.root",
        register: [outer],
        dependencies: { deepTask },
      });

      await expect(run(root)).rejects.toThrow(
        /exports\.no-reexport\.deep.*internal/,
      );
    });

    it("blocks when exported child resource does not export the target", async () => {
      const deepTask = defineTask({
        id: "exports.transitive-block.deep",
        run: async () => "deep",
      });

      const middle = defineResource({
        id: "exports.transitive-block.middle",
        register: [deepTask],
        exports: [],
      });

      const outer = defineResource({
        id: "exports.transitive-block.outer",
        register: [middle],
        exports: [middle],
      });

      const root = defineResource({
        id: "exports.transitive-block.root",
        register: [outer],
        dependencies: { deepTask },
      });

      await expect(run(root)).rejects.toThrow(
        /exports\.transitive-block\.deep.*internal/,
      );
    });
  });

  describe("builder and fork integration", () => {
    it("supports fluent .exports()", async () => {
      const publicTask = defineTask({
        id: "exports.fluent.public",
        run: async () => "fluent-public",
      });
      const privateTask = defineTask({
        id: "exports.fluent.private",
        run: async () => "fluent-private",
      });

      const child = r
        .resource("exports.fluent.child")
        .register([publicTask, privateTask])
        .exports([publicTask])
        .build();

      const root = defineResource({
        id: "exports.fluent.root",
        register: [child],
        dependencies: { privateTask },
      });

      await expect(run(root)).rejects.toThrow(
        /exports\.fluent\.private.*internal/,
      );
    });

    it("supports fluent .exports() override mode", async () => {
      const task1 = defineTask({
        id: "exports.fluent-override.t1",
        run: async () => "t1",
      });
      const task2 = defineTask({
        id: "exports.fluent-override.t2",
        run: async () => "t2",
      });

      const child = r
        .resource("exports.fluent-override.child")
        .register([task1, task2])
        .exports([task1])
        .exports([task2], { override: true })
        .build();

      const root = defineResource({
        id: "exports.fluent-override.root",
        register: [child],
        dependencies: { task1 },
      });

      await expect(run(root)).rejects.toThrow(
        /exports\.fluent-override\.t1.*internal/,
      );
    });

    it("fork inherits exports", async () => {
      const publicTask = defineTask({
        id: "exports.fork.public",
        run: async () => "fork-public",
      });
      const privateTask = defineTask({
        id: "exports.fork.private",
        run: async () => "fork-private",
      });

      const base = defineResource({
        id: "exports.fork.base",
        register: [publicTask, privateTask],
        exports: [publicTask],
      });
      const forked = base.fork("exports.fork.forked");

      const root = defineResource({
        id: "exports.fork.root",
        register: [forked],
        dependencies: { privateTask },
      });

      await expect(run(root)).rejects.toThrow(
        /exports\.fork\.private.*internal.*exports\.fork\.forked/,
      );
    });

    it("empty exports means nothing public", async () => {
      const task = defineTask({
        id: "exports.empty.task",
        run: async () => "value",
      });

      const child = defineResource({
        id: "exports.empty.child",
        register: [task],
        exports: [],
      });

      const root = defineResource({
        id: "exports.empty.root",
        register: [child],
        dependencies: { task },
      });

      await expect(run(root)).rejects.toThrow(
        /exports\.empty\.task.*internal.*exports\.empty\.child/,
      );
    });
  });
});
