import {
  defineResource,
  defineResourceMiddleware,
  defineTag,
  defineTask,
  defineTaskMiddleware,
} from "../../define";
import { run } from "../../run";

describe("run subtree middleware predicates", () => {
  it("applies different configs of the same task middleware id by predicate", async () => {
    const criticalTag = defineTag({
      id: "tests-subtree-predicate-task-critical-tag",
    });

    const labelMiddleware = defineTaskMiddleware<{ label: string }>({
      id: "tests-subtree-predicate-task-label-middleware",
      run: async ({ task, next }, _deps, config) => {
        const value = await next(task.input);
        return `${config.label}:${String(value)}`;
      },
    });

    const criticalTask = defineTask({
      id: "tests-subtree-predicate-task-critical",
      tags: [criticalTag],
      run: async () => "value",
    });

    const standardTask = defineTask({
      id: "tests-subtree-predicate-task-standard",
      run: async () => "value",
    });

    const app = defineResource({
      id: "tests-subtree-predicate-task-app",
      subtree: {
        tasks: {
          middleware: [
            {
              use: labelMiddleware.with({ label: "critical" }),
              when: (task) =>
                task.tags.some(
                  (tag: { id: string }) => tag.id === criticalTag.id,
                ),
            },
            {
              use: labelMiddleware.with({ label: "standard" }),
              when: (task) =>
                !task.tags.some(
                  (tag: { id: string }) => tag.id === criticalTag.id,
                ),
            },
          ],
        },
      },
      register: [criticalTag, labelMiddleware, criticalTask, standardTask],
      dependencies: { criticalTask, standardTask },
      init: async (_config, deps) => {
        const first = await deps.criticalTask();
        const second = await deps.standardTask();
        return `${first}|${second}`;
      },
    });

    const runtime = await run(app);
    expect(runtime.value).toBe("critical:value|standard:value");
    await runtime.dispose();
  });

  it("applies different configs of the same resource middleware id by predicate", async () => {
    const criticalTag = defineTag({
      id: "tests-subtree-predicate-resource-critical-tag",
    });

    const labelMiddleware = defineResourceMiddleware<{ label: string }>({
      id: "tests-subtree-predicate-resource-label-middleware",
      run: async ({ next }, _deps, config) => {
        const value = await next();
        return `${config.label}:${String(value)}`;
      },
    });

    const criticalResource = defineResource({
      id: "tests-subtree-predicate-resource-critical",
      tags: [criticalTag],
      init: async () => "value",
    });

    const standardResource = defineResource({
      id: "tests-subtree-predicate-resource-standard",
      init: async () => "value",
    });

    const app = defineResource({
      id: "tests-subtree-predicate-resource-app",
      subtree: {
        resources: {
          middleware: [
            {
              use: labelMiddleware.with({ label: "critical" }),
              when: (resource) =>
                resource.tags.some(
                  (tag: { id: string }) => tag.id === criticalTag.id,
                ),
            },
            {
              use: labelMiddleware.with({ label: "standard" }),
              when: (resource) =>
                !resource.tags.some(
                  (tag: { id: string }) => tag.id === criticalTag.id,
                ),
            },
          ],
        },
      },
      register: [
        criticalTag,
        labelMiddleware,
        criticalResource,
        standardResource,
      ],
      dependencies: { criticalResource, standardResource },
      init: async (_config, deps) => {
        return `${deps.criticalResource}|${deps.standardResource}`;
      },
    });

    const runtime = await run(app);
    expect(runtime.value).toBe("standard:critical:value|standard:value");
    await runtime.dispose();
  });

  it("fails fast when duplicate subtree middleware ids are applicable to the same task", async () => {
    const middleware = defineTaskMiddleware<{ label: string }>({
      id: "tests-subtree-predicate-duplicate-task-middleware",
      run: async ({ task, next }, _deps, config) => {
        const value = await next(task.input);
        return `${config.label}:${String(value)}`;
      },
    });

    const task = defineTask({
      id: "tests-subtree-predicate-duplicate-task",
      run: async () => "value",
    });

    const app = defineResource({
      id: "tests-subtree-predicate-duplicate-app",
      subtree: {
        tasks: {
          middleware: [
            { use: middleware.with({ label: "first" }), when: () => true },
            { use: middleware.with({ label: "second" }), when: () => true },
          ],
        },
      },
      register: [middleware, task],
    });

    await expect(run(app)).rejects.toThrow(/Duplicate middleware id/);
  });
});
