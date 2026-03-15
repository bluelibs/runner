import {
  defineResource,
  defineTag,
  defineTask,
  defineTaskMiddleware,
} from "../../define";
import { run } from "../../run";

describe("run tag identity matching", () => {
  it("distinguishes sibling tags that share a local id during runtime checks", async () => {
    const leftTag = defineTag<{ scope: string }>({
      id: "shared-tag",
    });
    const rightTag = defineTag<{ scope: string }>({
      id: "shared-tag",
    });

    const observations: Array<{
      leftExists: boolean;
      rightExists: boolean;
      leftScope: string | undefined;
      rightScope: string | undefined;
      taskId: string;
    }> = [];

    const probeMiddleware = defineTaskMiddleware({
      id: "tag-identity-probe",
      run: async ({ task, next }) => {
        observations.push({
          taskId: task.definition.id,
          leftExists: leftTag.exists(task.definition),
          rightExists: rightTag.exists(task.definition),
          leftScope: leftTag.extract(task.definition)?.scope,
          rightScope: rightTag.extract(task.definition)?.scope,
        });

        return next(task.input);
      },
    });

    const leftTask = defineTask({
      id: "left-task",
      tags: [leftTag.with({ scope: "left" })],
      run: async () => "left",
    });

    const rightTask = defineTask({
      id: "right-task",
      tags: [rightTag.with({ scope: "right" })],
      run: async () => "right",
    });

    const leftResource = defineResource({
      id: "left",
      register: [leftTag, leftTask],
    });

    const rightResource = defineResource({
      id: "right",
      register: [rightTag, rightTask],
    });

    const app = defineResource({
      id: "app",
      subtree: {
        tasks: {
          middleware: [probeMiddleware],
        },
      },
      register: [probeMiddleware, leftResource, rightResource],
      dependencies: { rightTask },
      init: async (_config, deps) => deps.rightTask(),
    });

    const runtime = await run(app);

    expect(runtime.value).toBe("right");
    expect(observations).toEqual([
      {
        taskId: "app.right.tasks.right-task",
        leftExists: false,
        rightExists: true,
        leftScope: undefined,
        rightScope: "right",
      },
    ]);

    await runtime.dispose();
  });
});
