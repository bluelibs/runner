import { defineResource, defineTask } from "../../define";
import { taskHealthResourceNotReportableError } from "../../errors";
import { globalTags } from "../../globals/globalTags";
import { createTestFixture } from "../test-utils";

describe("cached task health policy", () => {
  it("does not expose the cached resource list through a caught error", async () => {
    const { store, createTaskRunner } = createTestFixture();
    const taskRunner = createTaskRunner();
    const monitored = defineResource({ id: "unreportable" });
    const run = jest.fn(async () => "should not run");
    const task = defineTask({
      id: "guarded",
      tags: [globalTags.failWhenUnhealthy.with([monitored])],
      run,
    });
    store.resources.set(monitored.id, {
      resource: monitored,
      config: undefined,
      value: undefined,
      context: {},
      computedDependencies: {},
      isInitialized: true,
    });
    store.tasks.set(task.id, {
      task,
      computedDependencies: {},
      isInitialized: true,
    });
    store.lock();

    await taskRunner.run(task).catch((error: unknown) => {
      expect(taskHealthResourceNotReportableError.is(error)).toBe(true);
      if (taskHealthResourceNotReportableError.is(error)) {
        error.data.resourceIds.splice(0);
      }
    });

    await expect(taskRunner.run(task)).rejects.toMatchObject({
      id: "taskHealthResourceNotReportable",
      data: { resourceIds: [monitored.id] },
    });
    expect(run).not.toHaveBeenCalled();
  });
});
