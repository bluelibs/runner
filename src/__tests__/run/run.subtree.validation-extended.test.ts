import {
  defineEvent,
  defineHook,
  defineResource,
  defineResourceMiddleware,
  defineTag,
  defineTask,
  defineTaskMiddleware,
} from "../../define";
import { run } from "../../run";

describe("subtree validation extended targets", () => {
  it("validates hooks, middleware, events, and tags using compiled definitions", async () => {
    const policyTag = defineTag({
      id: "tests.subtree.validators.tag",
    });

    const policyEvent = defineEvent<{ value: string }>({
      id: "tests.subtree.validators.event",
    });

    const policyTaskMiddleware = defineTaskMiddleware({
      id: "tests.subtree.validators.taskMiddleware",
      run: async ({ next }) => next(),
    });

    const policyResourceMiddleware = defineResourceMiddleware({
      id: "tests.subtree.validators.resourceMiddleware",
      run: async ({ next }) => next(),
    });

    const policyTask = defineTask({
      id: "tests.subtree.validators.task",
      tags: [policyTag],
      middleware: [policyTaskMiddleware],
      run: async () => "ok",
    });

    const policyHook = defineHook({
      id: "tests.subtree.validators.hook",
      on: policyEvent,
      run: async () => undefined,
    });

    const policyResource = defineResource({
      id: "tests.subtree.validators.resource",
      tags: [policyTag],
      middleware: [policyResourceMiddleware],
      async init() {
        return "ok";
      },
    });

    const seenCompiled = {
      hook: false,
      taskMiddleware: false,
      resourceMiddleware: false,
      event: false,
      tag: false,
    };

    const app = defineResource({
      id: "tests.subtree.validators.app",
      register: [
        policyTag,
        policyEvent,
        policyTaskMiddleware,
        policyResourceMiddleware,
        policyTask,
        policyHook,
        policyResource,
      ],
      subtree: {
        hooks: {
          validate: (definition) => {
            if (definition.id !== policyHook.id) {
              return [];
            }

            seenCompiled.hook = Array.isArray(definition.tags);
            return [{ code: "custom", message: "hook policy check" }];
          },
        },
        taskMiddleware: {
          validate: (definition) => {
            if (definition.id !== policyTaskMiddleware.id) {
              return [];
            }

            seenCompiled.taskMiddleware =
              typeof definition.with === "function" &&
              typeof definition.config === "object";
            return [
              { code: "custom", message: "task middleware policy check" },
            ];
          },
        },
        resourceMiddleware: {
          validate: (definition) => {
            if (definition.id !== policyResourceMiddleware.id) {
              return [];
            }

            seenCompiled.resourceMiddleware =
              typeof definition.with === "function" &&
              typeof definition.config === "object";
            return [
              { code: "custom", message: "resource middleware policy check" },
            ];
          },
        },
        events: {
          validate: (definition) => {
            if (definition.id !== policyEvent.id) {
              return [];
            }

            seenCompiled.event = Array.isArray(definition.tags);
            return [{ code: "custom", message: "event policy check" }];
          },
        },
        tags: {
          validate: (definition) => {
            if (definition.id !== policyTag.id) {
              return [];
            }

            seenCompiled.tag =
              typeof definition.meta === "object" &&
              typeof definition.exists === "function";
            return [{ code: "custom", message: "tag policy check" }];
          },
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

    expect(message).toContain("Subtree policy validation failed");
    expect(message).toContain(`target=hook:${policyHook.id}`);
    expect(message).toContain(
      `target=task-middleware:${policyTaskMiddleware.id}`,
    );
    expect(message).toContain(
      `target=resource-middleware:${policyResourceMiddleware.id}`,
    );
    expect(message).toContain(`target=event:${policyEvent.id}`);
    expect(message).toContain(`target=tag:${policyTag.id}`);

    expect(seenCompiled).toEqual({
      hook: true,
      taskMiddleware: true,
      resourceMiddleware: true,
      event: true,
      tag: true,
    });
  });
});
