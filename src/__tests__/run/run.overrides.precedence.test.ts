import { defineResource, defineTask } from "../../define";
import { run } from "../../run";
import { r } from "../..";
import { RunnerMode } from "../../types/runner";

describe("run-overrides", () => {
  it("uses the outermost override when test mode has duplicate targets", async () => {
    const baseTask = defineTask({
      id: "task-same",
      run: async () => "Original",
    });

    const middleOverride = r.override(baseTask, async () => "Middle");
    const rootOverride = r.override(baseTask, async () => "Root");

    const middle = defineResource({
      id: "middle",
      register: [baseTask],
      overrides: [middleOverride],
    });

    const app = defineResource({
      id: "app",
      register: [middle],
      dependencies: { t: baseTask },
      overrides: [rootOverride],
      async init(_, deps) {
        return await deps.t();
      },
    });

    const result = await run(app, { mode: RunnerMode.TEST });
    expect(result.value).toBe("Root");
    await result.dispose();
  });

  it("uses the outermost override across three test-mode levels", async () => {
    const baseTask = defineTask({
      id: "task-three-level-same",
      run: async () => "Original",
    });

    const childOverride = r.override(baseTask, async () => "Child");
    const middleOverride = r.override(baseTask, async () => "Middle");
    const rootOverride = r.override(baseTask, async () => "Root");

    const child = defineResource({
      id: "child-three-level-same",
      register: [baseTask],
      overrides: [childOverride],
    });

    const middle = defineResource({
      id: "middle-three-level-same",
      register: [child],
      overrides: [middleOverride],
    });

    const app = defineResource({
      id: "app-three-level-same",
      register: [middle],
      dependencies: { task: baseTask },
      overrides: [rootOverride],
      async init(_, deps) {
        return deps.task();
      },
    });

    const result = await run(app, { mode: RunnerMode.TEST });
    expect(result.value).toBe("Root");
    await result.dispose();
  });

  it.each([RunnerMode.DEV, RunnerMode.PROD, RunnerMode.PRE_PROD])(
    "rejects overlapping declarations in %s mode",
    async (mode) => {
      const baseTask = defineTask({
        id: "task-same-non-test",
        run: async () => "Original",
      });

      const middleOverride = r.override(baseTask, async () => "Middle");
      const rootOverride = r.override(baseTask, async () => "Root");

      const middle = defineResource({
        id: "middle-non-test",
        register: [baseTask],
        overrides: [middleOverride],
      });

      const app = defineResource({
        id: "app-non-test",
        register: [middle],
        dependencies: { t: baseTask },
        overrides: [rootOverride],
        async init(_, deps) {
          return await deps.t();
        },
      });

      await expect(run(app, { mode })).rejects.toThrow(
        /declared more than once/,
      );
    },
  );

  it("blocks overrides that try to replace a parent's registration in test mode", async () => {
    const baseTask = defineTask({
      id: "override-parent-owned-task",
      run: async () => "base",
    });

    const childOverride = r.override(baseTask, async () => "child");

    const child = defineResource({
      id: "override-parent-owned-child",
      overrides: [childOverride],
    });

    const app = defineResource({
      id: "override-parent-owned-app",
      register: [baseTask, child],
    });

    await expect(run(app, { mode: RunnerMode.TEST })).rejects.toThrow(
      /cannot override Task "override-parent-owned-task" because it is outside that resource's registration subtree/,
    );
  });

  it("blocks overrides that target a sibling subtree", async () => {
    const siblingTask = defineTask({
      id: "override-sibling-task",
      run: async () => "base",
    });

    const sibling = defineResource({
      id: "override-sibling-owner",
      register: [siblingTask],
    });

    const childOverride = r.override(siblingTask, async () => "child");

    const otherChild = defineResource({
      id: "override-sibling-other-child",
      overrides: [childOverride],
    });

    const app = defineResource({
      id: "override-sibling-app",
      register: [sibling, otherChild],
    });

    await expect(run(app)).rejects.toThrow(
      /cannot override Task "override-sibling-task" because it is outside that resource's registration subtree/,
    );
  });

  it("still allows overrides declared from an ancestor resource", async () => {
    const baseTask = defineTask({
      id: "override-downstream-task",
      run: async () => "base",
    });

    const middle = defineResource({
      id: "override-downstream-middle",
      register: [baseTask],
    });

    const rootOverride = r.override(baseTask, async () => "root");

    const app = defineResource({
      id: "override-downstream-app",
      register: [middle],
      overrides: [rootOverride],
      dependencies: { task: baseTask },
      async init(_, deps) {
        return deps.task();
      },
    });

    const result = await run(app);
    expect(result.value).toBe("root");
    await result.dispose();
  });
});
