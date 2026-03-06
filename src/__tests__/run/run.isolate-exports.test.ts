import { defineResource, defineTask } from "../../define";
import { run } from "../../run";

describe("run.isolate exports", () => {
  it("fails fast when isolate.exports has an invalid shape", async () => {
    const child = defineResource({
      id: "isolate.exports.invalid-shape.child",
      isolate: { exports: "not-valid" as any },
    });

    const app = defineResource({
      id: "isolate.exports.invalid-shape.app",
      register: [child],
    });

    await expect(run(app)).rejects.toMatchObject({
      id: "runner.errors.isolateInvalidExports",
    });
  });

  it("fails fast when isolate.exports references an unknown target id", async () => {
    const child = defineResource({
      id: "isolate.exports.unknown-target.child",
      isolate: { exports: ["does.not.exist"] as any },
    });

    const app = defineResource({
      id: "isolate.exports.unknown-target.app",
      register: [child],
    });

    await expect(run(app)).rejects.toMatchObject({
      id: "runner.errors.isolateExportsUnknownTarget",
    });
  });

  it("fails fast when isolate.exports wildcard matches no ids", async () => {
    const child = defineResource({
      id: "isolate.exports.unknown-selector.child",
      isolate: { exports: ["isolate.exports.unknown-selector.missing.*"] },
    });

    const app = defineResource({
      id: "isolate.exports.unknown-selector.app",
      register: [child],
    });

    await expect(run(app)).rejects.toMatchObject({
      id: "runner.errors.isolateExportsUnknownTarget",
    });
  });

  it("fails fast when isolate.exports contains an invalid entry", async () => {
    const child = defineResource({
      id: "isolate.exports.invalid-entry.child",
      isolate: { exports: [{} as any] },
    });

    const app = defineResource({
      id: "isolate.exports.invalid-entry.app",
      register: [child],
    });

    await expect(run(app)).rejects.toMatchObject({
      id: "runner.errors.isolateInvalidExports",
    });
  });

  it("supports legacy exports (deprecated) by mapping to isolate.exports", async () => {
    const task = defineTask({
      id: "isolate.exports.legacy.task",
      run: async () => "ok",
    });

    const boundary = defineResource({
      id: "isolate.exports.legacy.boundary",
      register: [task],
      exports: [],
    });

    const app = defineResource({
      id: "isolate.exports.legacy.app",
      register: [boundary],
      dependencies: { task },
    });

    await expect(run(app)).rejects.toMatchObject({
      id: "runner.errors.visibilityViolation",
    });
  });

  it("rejects legacy exports selectors (deprecated string wildcard ids)", async () => {
    const publicTask = defineTask({
      id: "isolate.exports.legacy-selector.api.public",
      run: async () => "ok",
    });
    const privateTask = defineTask({
      id: "isolate.exports.legacy-selector.internal.private",
      run: async () => "secret",
    });

    const boundary = defineResource({
      id: "isolate.exports.legacy-selector.boundary",
      register: [publicTask, privateTask],
      exports: ["isolate.exports.legacy-selector.api.*"],
    });

    const app = defineResource({
      id: "isolate.exports.legacy-selector.app",
      register: [boundary],
      dependencies: { publicTask },
      init: async (_cfg, deps) => deps.publicTask(),
    });

    await expect(run(app)).rejects.toMatchObject({
      id: "runner.errors.isolateExportsUnknownTarget",
    });
  });

  it("rejects isolate.exports wildcard selectors", async () => {
    const publicTask = defineTask({
      id: "isolate.exports.selector.api.public",
      run: async () => "ok",
    });
    const privateTask = defineTask({
      id: "isolate.exports.selector.internal.private",
      run: async () => "secret",
    });

    const child = defineResource({
      id: "isolate.exports.selector.child",
      register: [publicTask, privateTask],
      isolate: { exports: ["isolate.exports.selector.api.*"] },
    });

    const app = defineResource({
      id: "isolate.exports.selector.app",
      register: [child],
      dependencies: { publicTask },
      init: async (_config, deps) => deps.publicTask(),
    });

    await expect(run(app)).rejects.toMatchObject({
      id: "runner.errors.isolateExportsUnknownTarget",
    });
  });

  it("supports legacy exports alongside isolate deny/only in a single definition", async () => {
    const boundary = defineResource({
      id: "isolate.exports.legacy-with-isolate.boundary",
      exports: [],
      isolate: { deny: [] },
    });

    const app = defineResource({
      id: "isolate.exports.legacy-with-isolate.app",
      register: [boundary],
    });

    const runtime = await run(app);
    await runtime.dispose();
  });

  it("throws when both legacy exports and isolate exports are declared", () => {
    const task = defineTask({
      id: "isolate.exports.conflict.task",
      run: async () => "ok",
    });

    try {
      defineResource({
        id: "isolate.exports.conflict.resource",
        register: [task],
        exports: [],
        isolate: { exports: "none" },
      } as any);
      throw new Error("Expected defineResource() to throw");
    } catch (error: unknown) {
      expect(error).toMatchObject({
        id: "runner.errors.isolateExportsConflict",
      });
    }
  });
});
