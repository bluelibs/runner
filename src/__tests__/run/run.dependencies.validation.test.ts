import { defineEvent, defineResource, defineTask, isTask } from "../../define";
import { run } from "../../run";

describe("run dependency map validation", () => {
  it("fails fast when a task dependency factory returns a non-object", async () => {
    const invalidTask = defineTask({
      id: "run.dependency.validation.task.invalid",
      dependencies: (() => "bad-shape") as any,
      run: async () => "ok",
    });

    const app = defineResource({
      id: "run.dependency.validation.task.app",
      register: [invalidTask],
      init: async () => "never",
    });

    await expect(run(app)).rejects.toMatchObject({
      id: "runner.errors.validation",
    });
  });

  it("fails fast when root dependency factory returns a non-object", async () => {
    const app = defineResource({
      id: "run.dependency.validation.root.app",
      dependencies: (() => "bad-root-shape") as any,
      init: async () => "never",
    });

    await expect(run(app)).rejects.toMatchObject({
      id: "runner.errors.validation",
    });
  });

  it("exposes normalized dependency maps to subtree validators", async () => {
    const appId = "run.dependency.validation.subtree.app";
    const event = defineEvent({
      id: "run.dependency.validation.subtree.event",
    });
    const expectedEventId = `${appId}.events.${event.id}`;

    let sawNormalizedDependencies = false;

    const task = defineTask({
      id: "run.dependency.validation.subtree.task",
      dependencies: () => ({ event }),
      run: async () => "ok",
    });

    const app = defineResource({
      id: appId,
      register: [event, task],
      subtree: {
        validate: (definition) => {
          if (
            !isTask(definition) ||
            !definition.id.endsWith(
              ".tasks.run.dependency.validation.subtree.task",
            )
          ) {
            return [];
          }

          const deps = definition.dependencies as Record<string, { id: string }>;
          sawNormalizedDependencies =
            typeof definition.dependencies === "object" &&
            (deps.event?.id === event.id || deps.event?.id === expectedEventId);

          return [
            {
              code: "subtree-dependency-check",
              message: "forced policy violation for assertion",
            },
          ];
        },
      },
      init: async () => "never",
    });

    await expect(run(app)).rejects.toMatchObject({
      id: "runner.errors.subtreeValidationFailed",
    });
    expect(sawNormalizedDependencies).toBe(true);
  });
});
