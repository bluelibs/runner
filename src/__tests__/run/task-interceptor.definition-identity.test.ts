import { defineResource, defineTask } from "../../define";
import { globalResources } from "../../globals/globalResources";
import { isSameDefinition } from "../../public";
import { run } from "../../run";

describe("taskRunner.intercept definition identity", () => {
  it("matches the intended sibling task when local ids collide", async () => {
    const leftTask = defineTask({
      id: "shared-task",
      run: async () => "left",
    });

    const rightTask = defineTask({
      id: "shared-task",
      run: async () => "right",
    });

    const leftResource = defineResource({
      id: "left",
      register: [leftTask],
    });

    const rightResource = defineResource({
      id: "right",
      register: [rightTask],
    });

    const installer = defineResource({
      id: "installer",
      dependencies: { taskRunner: globalResources.taskRunner },
      async init(_config, deps) {
        deps.taskRunner.intercept(
          async (next, input) => {
            const result = await next(input);
            return `intercepted:${result}`;
          },
          {
            when: (taskDefinition) =>
              isSameDefinition(taskDefinition, rightTask),
          },
        );

        return undefined;
      },
    });

    const app = defineResource({
      id: "app",
      register: [leftResource, rightResource, installer],
    });

    const runtime = await run(app);

    await expect(runtime.runTask(leftTask)).resolves.toBe("left");
    await expect(runtime.runTask(rightTask)).resolves.toBe("intercepted:right");

    await runtime.dispose();
  });
});
