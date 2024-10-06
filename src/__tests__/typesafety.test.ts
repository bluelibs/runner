import { defineEvent, defineTask, defineResource } from "../define";
import { RegisterableItems } from "../defs";

describe("typesafety", () => {
  it("tasks, resources: should have propper type safety for dependeices", async () => {
    type InputTask = {
      message: string;
    };

    const event = defineEvent<{ message: string }>({
      id: "event",
    });

    const baseTask = defineTask({
      id: "task",
      run: async (input: InputTask) => "Task executed",
    });

    const task = defineTask({
      id: "task",
      dependencies: { baseTask, event },
      run: async (input: InputTask, deps) => {
        deps.event({ message: input.message });
        // @ts-expect-error
        deps.event({ messagex: input.message });

        deps.baseTask({
          message: "Hello, World!",
        });

        deps.baseTask({
          // @ts-expect-error
          messagex: 123,
        });

        // bc no arguments and its required
        // @ts-expect-error
        deps.baseTask();
      },
    });

    type ResourceType = {
      ok: boolean;
    };

    const dummyResource = defineResource({
      id: "dummy.resource",
      init: async (config: ResourceType) => "Resource Value",
    });
    const dummyResourceNoConfig = defineResource({
      id: "dummy.resource",
      init: async () => "Resource Value",
    });

    const testResource = defineResource({
      id: "test.resource",
      dependencies: { task, dummyResource, event },
      init: async (_, deps) => {
        const result = await deps.task({
          message: "Hello, World!",
        });

        deps.event({ message: "Hello, World!" });
        // @ts-expect-error
        deps.event();
        // @ts-expect-error
        deps.event({ messagex: "Hello, World!" });

        // @ts-expect-error
        deps.dummyResource as number;

        deps.dummyResource as string;

        // @ts-expect-error
        result === 1;

        // @ts-expect-error
        deps.task2;
      },
      register: () => [
        dummyResourceNoConfig,
        // @ts-expect-error
        dummyResourceNoConfig.with("hello"),
        // @ts-expect-error
        dummyResourceNoConfig.with({ anyObject: true }),
        dummyResource.with({ ok: true }),
        // @ts-expect-error
        dummyResource.with({ ok: 123 }),
        // @ts-expect-error
        dummyResource.with(),
      ],
    });

    expect(true).toBe(true);
  });

  it("events: should have propper type safety", async () => {
    const hookEvent = defineEvent<{ message: string }>({ id: "hook.event" });

    const task = defineTask({
      id: "task",
      run: async () => "Task executed",
    });

    const testResource = defineResource({
      id: "test.resource",
      dependencies: { task },
      init: async () => "Resource Value",
      hooks: [
        {
          event: hookEvent,
          run: (event, deps) => {
            // @ts-expect-error
            event.data.x;

            event.data.message;
            deps.task;
            // @ts-expect-error
            deps.task2;
          },
        },
      ],
    });

    expect(true).toBe(true);
  });
});
