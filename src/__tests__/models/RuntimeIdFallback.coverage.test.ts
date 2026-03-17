import { defineResource, defineTask } from "../../define";
import { globalTags } from "../../globals/globalTags";
import { HealthReporter } from "../../models/HealthReporter";
import { createTestFixture } from "../test-utils";

describe("runtime id fallback coverage", () => {
  it("falls back to String(reference) in HealthReporter id resolution", () => {
    const reporter = new HealthReporter(
      {
        resolveDefinitionId: () => undefined,
      } as any,
      {
        ensureAvailable: () => undefined,
      },
    );

    expect((reporter as any).resolveDefinitionId({ bad: true })).toBe(
      "[object Object]",
    );
  });

  it("fails fast for unregistered task health resources", async () => {
    const fixture = createTestFixture();
    const taskRunner = fixture.createTaskRunner();
    const detached = defineResource({
      id: "task-runner-runtime-id-detached",
    });
    const task = defineTask({
      id: "task-runner-runtime-id-fallback",
      tags: [globalTags.failWhenUnhealthy.with([detached])],
      async run() {
        return "ok";
      },
    });

    fixture.store.tasks.set(task.id, {
      task,
      computedDependencies: {},
      isInitialized: true,
    });
    fixture.store.lock();

    await expect(taskRunner.run(task)).rejects.toThrow(
      `Definition "${detached.id}" not found.`,
    );
  });

  it("fails fast in RunResult resource access when ids are unresolved", () => {
    const fixture = createTestFixture();
    const taskRunner = fixture.createTaskRunner();
    fixture.store.setTaskRunner(taskRunner);
    const runtime = fixture.createRuntimeResult(taskRunner);

    expect(() =>
      runtime.getResourceValue("runtime-id-fallback-missing"),
    ).toThrow('Definition "runtime-id-fallback-missing" not found.');
  });
});
