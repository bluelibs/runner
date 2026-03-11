import {
  defineEvent,
  defineHook,
  defineResource,
  defineResourceMiddleware,
  defineTag,
  defineTask,
  defineTaskMiddleware,
} from "../../define";
import {
  isEvent,
  isHook,
  isResourceMiddleware,
  isTag,
  isTaskMiddleware,
} from "../../definers/tools";
import { run } from "../../run";

describe("subtree validation extended targets", () => {
  it("validates hooks, middleware, events, and tags using compiled definitions", async () => {
    const policyTag = defineTag({
      id: "tests-subtree-validators-tag",
    });

    const policyEvent = defineEvent<{ value: string }>({
      id: "tests-subtree-validators-event",
    });

    const policyTaskMiddleware = defineTaskMiddleware({
      id: "tests-subtree-validators-taskMiddleware",
      run: async ({ next }) => next(),
    });

    const policyResourceMiddleware = defineResourceMiddleware({
      id: "tests-subtree-validators-resourceMiddleware",
      run: async ({ next }) => next(),
    });

    const policyTask = defineTask({
      id: "tests-subtree-validators-task",
      tags: [policyTag],
      middleware: [policyTaskMiddleware],
      run: async () => "ok",
    });

    const policyHook = defineHook({
      id: "tests-subtree-validators-hook",
      on: policyEvent,
      run: async () => undefined,
    });

    const policyResource = defineResource({
      id: "tests-subtree-validators-resource",
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
      id: "tests-subtree-validators-app",
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
        validate: (definition) => {
          if (isHook(definition) && definition.id.endsWith(policyHook.id)) {
            seenCompiled.hook = Array.isArray(definition.tags);
            return [{ code: "custom", message: "hook policy check" }];
          }
          if (
            isTaskMiddleware(definition) &&
            definition.id.endsWith(policyTaskMiddleware.id)
          ) {
            seenCompiled.taskMiddleware =
              typeof definition.with === "function" &&
              typeof definition.config === "object";
            return [
              { code: "custom", message: "task middleware policy check" },
            ];
          }
          if (
            isResourceMiddleware(definition) &&
            definition.id.endsWith(policyResourceMiddleware.id)
          ) {
            seenCompiled.resourceMiddleware =
              typeof definition.with === "function" &&
              typeof definition.config === "object";
            return [
              { code: "custom", message: "resource middleware policy check" },
            ];
          }
          if (isEvent(definition) && definition.id.endsWith(policyEvent.id)) {
            seenCompiled.event = Array.isArray(definition.tags);
            return [{ code: "custom", message: "event policy check" }];
          }
          if (isTag(definition) && definition.id.endsWith(policyTag.id)) {
            seenCompiled.tag =
              typeof definition.meta === "object" &&
              typeof definition.exists === "function";
            return [{ code: "custom", message: "tag policy check" }];
          }
          return [];
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
    expect(message).toContain("target=hook:");
    expect(message).toContain("target=task-middleware:");
    expect(message).toContain("target=resource-middleware:");
    expect(message).toContain("target=event:");
    expect(message).toContain("target=tag:");

    expect(seenCompiled).toEqual({
      hook: true,
      taskMiddleware: true,
      resourceMiddleware: true,
      event: true,
      tag: true,
    });
  });

  it("supports typed subtree validators for non-task/resource targets", async () => {
    const policyTag = defineTag({
      id: "tests-subtree-typed-tag",
    });
    const policyEvent = defineEvent({
      id: "tests-subtree-typed-event",
    });
    const policyTaskMiddleware = defineTaskMiddleware({
      id: "tests-subtree-typed-task-middleware",
      run: async ({ next }) => next(),
    });
    const policyResourceMiddleware = defineResourceMiddleware({
      id: "tests-subtree-typed-resource-middleware",
      run: async ({ next }) => next(),
    });
    const policyHook = defineHook({
      id: "tests-subtree-typed-hook",
      on: policyEvent,
      run: async () => undefined,
    });

    const calls = {
      hook: 0,
      event: 0,
      tag: 0,
      taskMiddleware: 0,
      resourceMiddleware: 0,
    };

    const app = defineResource({
      id: "tests-subtree-typed-app",
      register: [
        policyTag,
        policyEvent,
        policyTaskMiddleware,
        policyResourceMiddleware,
        policyHook,
      ],
      subtree: {
        hooks: {
          validate: () => {
            calls.hook += 1;
            return [];
          },
        },
        events: {
          validate: () => {
            calls.event += 1;
            return [];
          },
        },
        tags: {
          validate: () => {
            calls.tag += 1;
            return [];
          },
        },
        taskMiddleware: {
          validate: () => {
            calls.taskMiddleware += 1;
            return [];
          },
        },
        resourceMiddleware: {
          validate: () => {
            calls.resourceMiddleware += 1;
            return [];
          },
        },
      },
      async init() {
        return "ok";
      },
    });

    await run(app);

    expect(calls).toEqual({
      hook: 2,
      event: 2,
      tag: 2,
      taskMiddleware: 2,
      resourceMiddleware: 2,
    });
  });
});
