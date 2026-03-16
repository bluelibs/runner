import { defineResource, defineTask } from "../../define";
import { run } from "../../run";

describe("run.isolate exports", () => {
  it("fails fast when isolate.exports has an invalid shape", async () => {
    const child = defineResource({
      id: "isolate-exports-invalid-shape-child",
      isolate: { exports: "not-valid" as any },
    });

    const app = defineResource({
      id: "isolate-exports-invalid-shape-app",
      register: [child],
    });

    await expect(run(app)).rejects.toMatchObject({
      id: "isolateInvalidExports",
    });
  });

  it("fails fast when isolate.exports contains string ids", async () => {
    const child = defineResource({
      id: "isolate-exports-unknown-target-child",
      isolate: { exports: ["does-not-exist"] as any },
    });

    const app = defineResource({
      id: "isolate-exports-unknown-target-app",
      register: [child],
    });

    await expect(run(app)).rejects.toMatchObject({
      id: "isolateInvalidExports",
    });
  });

  it("fails fast when isolate.exports contains wildcard strings", async () => {
    const child = defineResource({
      id: "isolate-exports-unknown-selector-child",
      isolate: {
        exports: ["isolate.exports.unknown-selector.missing.*"] as any,
      },
    });

    const app = defineResource({
      id: "isolate-exports-unknown-selector-app",
      register: [child],
    });

    await expect(run(app)).rejects.toMatchObject({
      id: "isolateInvalidExports",
    });
  });

  it("fails fast when isolate.exports contains an invalid entry", async () => {
    const child = defineResource({
      id: "isolate-exports-invalid-entry-child",
      isolate: { exports: [{} as any] },
    });

    const app = defineResource({
      id: "isolate-exports-invalid-entry-app",
      register: [child],
    });

    await expect(run(app)).rejects.toMatchObject({
      id: "isolateInvalidExports",
    });
  });

  it("rejects isolate.exports wildcard string entries", async () => {
    const publicTask = defineTask({
      id: "isolate-exports-selector-api-public",
      run: async () => "ok",
    });
    const privateTask = defineTask({
      id: "isolate-exports-selector-internal-private",
      run: async () => "secret",
    });

    const child = defineResource({
      id: "isolate-exports-selector-child",
      register: [publicTask, privateTask],
      isolate: { exports: ["isolate.exports.selector.api.*"] as any },
    });

    const app = defineResource({
      id: "isolate-exports-selector-app",
      register: [child],
      dependencies: { publicTask },
      init: async (_config, deps) => deps.publicTask(),
    });

    await expect(run(app)).rejects.toMatchObject({
      id: "isolateInvalidExports",
    });
  });
});
