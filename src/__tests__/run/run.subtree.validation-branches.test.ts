import { defineResource, defineTask } from "../../define";
import { run } from "../../run";
import { isResource, isTask } from "../../definers/tools";

describe("run subtree validation branches", () => {
  it("fails fast when subtree task middleware is not registered", async () => {
    const app = defineResource({
      id: "tests-subtree-missing-task-middleware-app",
      subtree: {
        tasks: {
          middleware: [{ id: "tests-subtree-missing-task-middleware" } as any],
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
      id: "tests-subtree-missing-conditional-task-middleware-app",
      subtree: {
        tasks: {
          middleware: [
            {
              use: {
                id: "tests-subtree-missing-conditional-task-middleware",
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
      id: "tests-subtree-missing-resource-middleware-app",
      subtree: {
        resources: {
          middleware: [
            { id: "tests-subtree-missing-resource-middleware" } as any,
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
      id: "tests-subtree-missing-conditional-resource-middleware-app",
      subtree: {
        resources: {
          middleware: [
            {
              use: {
                id: "tests-subtree-missing-conditional-resource-middleware",
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
      id: "tests-subtree-branches-validator-task",
      async run() {
        return "ok";
      },
    });

    const child = defineResource({
      id: "tests-subtree-branches-validator-child",
      async init() {
        return "ok";
      },
    });

    const app = defineResource({
      id: "tests-subtree-branches-validator-app",
      register: [task, child],
      subtree: {
        validate: (definition) => {
          if (isTask(definition) && definition.id.endsWith(task.id)) {
            seen.task = typeof definition.run === "function";
          }
          if (isResource(definition) && definition.id.endsWith(child.id)) {
            seen.resource = typeof definition.init === "function";
          }
          return [];
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
      id: "tests-subtree-branches-invalid-validator-task",
      async run() {
        return "ok";
      },
    });

    const app = defineResource({
      id: "tests-subtree-branches-invalid-validator-app",
      register: [task],
      subtree: {
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

  it("runs generic and typed validators together for matching items", async () => {
    const task = defineTask({
      id: "tests-subtree-branches-typed-validator-task",
      async run() {
        return "ok";
      },
    });

    const counts = {
      generic: 0,
      typed: 0,
    };

    const app = defineResource({
      id: "tests-subtree-branches-typed-validator-app",
      register: [task],
      subtree: {
        validate: (definition) => {
          if (isTask(definition) && definition.id.endsWith(task.id)) {
            counts.generic += 1;
          }
          return [];
        },
        tasks: {
          validate: (definition) => {
            if (definition.id.endsWith(task.id)) {
              counts.typed += 1;
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

    expect(counts).toEqual({
      generic: 2,
      typed: 2,
    });
  });

  it("resolves subtree callbacks against resource config", async () => {
    const task = defineTask({
      id: "tests-subtree-branches-dynamic-task",
      async run() {
        return "ok";
      },
    });

    const app = defineResource({
      id: "tests-subtree-branches-dynamic-app",
      register: [task],
      subtree: (config: { enabled: boolean }) => ({
        tasks: {
          validate: config.enabled
            ? () => [
                {
                  code: "dynamic-task-check",
                  message: "dynamic subtree validation fired",
                },
              ]
            : [],
        },
      }),
      async init() {
        return "ok";
      },
    });

    await expect(run(app.with({ enabled: false }))).resolves.toBeDefined();
    await expect(run(app.with({ enabled: true }))).rejects.toMatchObject({
      id: "subtreeValidationFailed",
    });
  });
});
