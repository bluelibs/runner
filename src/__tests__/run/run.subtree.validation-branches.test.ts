import { defineResource, defineTask } from "../../define";
import { run } from "../../run";

describe("run subtree validation branches", () => {
  it("fails fast when subtree task middleware is not registered", async () => {
    const app = defineResource({
      id: "tests.subtree.missing.task.middleware.app",
      subtree: {
        tasks: {
          middleware: [{ id: "tests.subtree.missing.task.middleware" } as any],
        },
      },
      async init() {
        return "never";
      },
    });

    await expect(run(app)).rejects.toThrow(/not registered/);
  });

  it("fails fast when conditional subtree task middleware is not registered", async () => {
    const app = defineResource({
      id: "tests.subtree.missing.conditional.task.middleware.app",
      subtree: {
        tasks: {
          middleware: [
            {
              use: {
                id: "tests.subtree.missing.conditional.task.middleware",
              } as any,
              when: () => true,
            },
          ],
        },
      },
      async init() {
        return "never";
      },
    });

    await expect(run(app)).rejects.toThrow(/not registered/);
  });

  it("fails fast when subtree resource middleware is not registered", async () => {
    const app = defineResource({
      id: "tests.subtree.missing.resource.middleware.app",
      subtree: {
        resources: {
          middleware: [
            { id: "tests.subtree.missing.resource.middleware" } as any,
          ],
        },
      },
      async init() {
        return "never";
      },
    });

    await expect(run(app)).rejects.toThrow(/not registered/);
  });

  it("fails fast when conditional subtree resource middleware is not registered", async () => {
    const app = defineResource({
      id: "tests.subtree.missing.conditional.resource.middleware.app",
      subtree: {
        resources: {
          middleware: [
            {
              use: {
                id: "tests.subtree.missing.conditional.resource.middleware",
              } as any,
              when: () => true,
            },
          ],
        },
      },
      async init() {
        return "never";
      },
    });

    await expect(run(app)).rejects.toThrow(/not registered/);
  });

  it("passes compiled task/resource definitions to subtree validators", async () => {
    const seen = {
      task: false,
      resource: false,
    };

    const task = defineTask({
      id: "tests.subtree.branches.validator.task",
      async run() {
        return "ok";
      },
    });

    const child = defineResource({
      id: "tests.subtree.branches.validator.child",
      async init() {
        return "ok";
      },
    });

    const app = defineResource({
      id: "tests.subtree.branches.validator.app",
      register: [task, child],
      subtree: {
        tasks: {
          validate: (definition) => {
            if (definition.id === task.id) {
              seen.task = typeof definition.run === "function";
            }
            return [];
          },
        },
        resources: {
          validate: (definition) => {
            if (definition.id === child.id) {
              seen.resource = typeof definition.init === "function";
            }
            return [];
          },
        },
      },
      async init() {
        return "ok";
      },
    });

    await run(app);

    expect(seen).toEqual({
      task: true,
      resource: true,
    });
  });

  it("converts invalid validator outputs into invalid-definition violations", async () => {
    const task = defineTask({
      id: "tests.subtree.branches.invalid-validator.task",
      async run() {
        return "ok";
      },
    });

    const app = defineResource({
      id: "tests.subtree.branches.invalid-validator.app",
      register: [task],
      subtree: {
        tasks: {
          validate: [
            () => "invalid" as any,
            () => {
              throw "validator exploded";
            },
            () => {
              throw new Error("validator error object");
            },
          ],
        },
      },
      async init() {
        return "never";
      },
    });

    let message = "";
    try {
      await run(app);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("invalid-definition");
    expect(message).toContain("Validator must return an array");
    expect(message).toContain("validator exploded");
    expect(message).toContain("validator error object");
  });
});
