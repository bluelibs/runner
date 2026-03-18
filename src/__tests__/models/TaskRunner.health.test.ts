import { defineResource, defineTask } from "../../define";
import { globalTags } from "../../globals/globalTags";
import { createTestFixture } from "../test-utils";

describe("TaskRunner health policy", () => {
  it("blocks unhealthy monitored resources without going through RunResult", async () => {
    const fixture = createTestFixture();
    const { store } = fixture;
    const taskRunner = fixture.createTaskRunner();
    const monitored = defineResource({
      id: "task-runner-health-monitored",
      async health() {
        return { status: "unhealthy" as const };
      },
    });
    const task = defineTask({
      id: "task-runner-health-blocked",
      tags: [globalTags.failWhenUnhealthy.with([monitored])],
      async run() {
        return "ok";
      },
    });

    store.resources.set(monitored.id, {
      resource: monitored,
      config: undefined,
      value: { connected: false },
      context: {},
      computedDependencies: {},
      isInitialized: true,
    } as any);
    store.tasks.set(task.id, {
      task,
      computedDependencies: {},
      isInitialized: true,
    });
    store.lock();

    await expect(taskRunner.run(task)).rejects.toMatchObject({
      id: "taskBlockedByResourceHealth",
    });
  });

  it("skips sleeping monitored resources during task health checks", async () => {
    const fixture = createTestFixture();
    const { store } = fixture;
    const taskRunner = fixture.createTaskRunner();
    const health = jest.fn(async () => ({ status: "unhealthy" as const }));
    const sleeping = defineResource({
      id: "task-runner-health-sleeping",
      health,
    });
    const task = defineTask({
      id: "task-runner-health-skip-sleeping",
      tags: [globalTags.failWhenUnhealthy.with([sleeping])],
      async run() {
        return "ok";
      },
    });

    store.resources.set(sleeping.id, {
      resource: sleeping,
      config: undefined,
      value: undefined,
      context: {},
      computedDependencies: {},
      isInitialized: false,
    } as any);
    store.tasks.set(task.id, {
      task,
      computedDependencies: {},
      isInitialized: true,
    });
    store.lock();

    await expect(taskRunner.run(task)).resolves.toBe("ok");
    expect(health).not.toHaveBeenCalled();
  });
});
