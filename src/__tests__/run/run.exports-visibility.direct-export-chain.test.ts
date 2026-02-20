import { defineResource, defineTask } from "../../define";
import { run } from "../../run";

describe("run.exports-visibility direct export chain", () => {
  it("does not allow a sibling resource to export another sibling's private item", async () => {
    const b = defineTask({
      id: "exports.sibling.invalid-export.b",
      run: async () => "b",
    });
    const d = defineTask({
      id: "exports.sibling.invalid-export.d",
      run: async () => "d",
    });

    const a = defineResource({
      id: "exports.sibling.invalid-export.a",
      register: [b],
      exports: [d],
    });

    const c = defineResource({
      id: "exports.sibling.invalid-export.c",
      register: [d],
      exports: [],
    });

    const e = defineResource({
      id: "exports.sibling.invalid-export.e",
      register: [a, c],
    });

    const root = defineResource({
      id: "exports.sibling.invalid-export.root",
      register: [e],
      dependencies: { d },
    });

    await expect(run(root)).rejects.toThrow(
      /exports\.sibling\.invalid-export\.d.*internal.*exports\.sibling\.invalid-export\.c/,
    );
  });

  it("allows double-export across the chain when both boundaries export the same item", async () => {
    const deepTask = defineTask({
      id: "exports.direct-chain.double-export.deep-task",
      run: async () => "ok",
    });

    const middle = defineResource({
      id: "exports.direct-chain.double-export.middle",
      register: [deepTask],
      exports: [deepTask],
    });

    const outer = defineResource({
      id: "exports.direct-chain.double-export.outer",
      register: [middle],
      exports: [deepTask],
    });

    const root = defineResource({
      id: "exports.direct-chain.double-export.root",
      register: [outer],
      dependencies: { deepTask },
      async init(_, deps) {
        return await deps.deepTask();
      },
    });

    const runtime = await run(root);
    expect(runtime.value).toBe("ok");
    await runtime.dispose();
  });

  it("allows grandparent direct export when middle resource has no exports gate", async () => {
    const deepTask = defineTask({
      id: "exports.direct-chain.allowed.deep-task",
      run: async () => "ok",
    });

    const middle = defineResource({
      id: "exports.direct-chain.allowed.middle",
      register: [deepTask],
    });

    const outer = defineResource({
      id: "exports.direct-chain.allowed.outer",
      register: [middle],
      exports: [deepTask],
    });

    const root = defineResource({
      id: "exports.direct-chain.allowed.root",
      register: [outer],
      dependencies: { deepTask },
      async init(_, deps) {
        return await deps.deepTask();
      },
    });

    const runtime = await run(root);
    expect(runtime.value).toBe("ok");
    await runtime.dispose();
  });

  it("blocks grandparent direct export when middle resource exports []", async () => {
    const deepTask = defineTask({
      id: "exports.direct-chain.blocked.deep-task",
      run: async () => "ok",
    });

    const middle = defineResource({
      id: "exports.direct-chain.blocked.middle",
      register: [deepTask],
      exports: [],
    });

    const outer = defineResource({
      id: "exports.direct-chain.blocked.outer",
      register: [middle],
      exports: [deepTask],
    });

    const root = defineResource({
      id: "exports.direct-chain.blocked.root",
      register: [outer],
      dependencies: { deepTask },
    });

    await expect(run(root)).rejects.toThrow(
      /exports\.direct-chain\.blocked\.deep-task.*internal.*exports\.direct-chain\.blocked\.middle/,
    );
  });

  it("does not throw at declaration-time for impossible export, but fails at run init when consumed", async () => {
    const buildRoot = () => {
      const deepTask = defineTask({
        id: "exports.direct-chain.declare-vs-run.deep-task",
        run: async () => "ok",
      });

      const middle = defineResource({
        id: "exports.direct-chain.declare-vs-run.middle",
        register: [deepTask],
        exports: [],
      });

      const outer = defineResource({
        id: "exports.direct-chain.declare-vs-run.outer",
        register: [middle],
        exports: [deepTask],
      });

      return defineResource({
        id: "exports.direct-chain.declare-vs-run.root",
        register: [outer],
        dependencies: { deepTask },
      });
    };

    expect(buildRoot).not.toThrow();
    const root = buildRoot();

    await expect(run(root)).rejects.toThrow(
      /exports\.direct-chain\.declare-vs-run\.deep-task.*internal.*exports\.direct-chain\.declare-vs-run\.middle/,
    );
  });
});
