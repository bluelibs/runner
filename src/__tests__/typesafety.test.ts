import {
  defineEvent,
  defineTask,
  defineResource,
  defineMiddleware,
  defineOverride,
  defineTag,
} from "../define";
import {
  IEventDefinition,
  IMeta,
  IMiddlewareDefinition,
  IResource,
  IResourceWithConfig,
  ITaskDefinition,
  RegisterableItems,
} from "../defs";
import { createTestResource } from "..";
import {
  EnsureResponseSatisfiesContracts,
  HasContracts,
} from "../defs.returnTag";

// This is skipped because we mostly check typesafety.
describe.skip("typesafety", () => {
  it("tasks, resources: should have propper type safety for dependeices", async () => {
    type InputTask = {
      message: string;
    };

    const middleware = defineMiddleware({
      id: "middleware",
      run: async (input, deps) => {
        return input;
      },
    });

    type MiddlewareConfig = {
      message: string;
    };

    type MiddlewareOptionalConfig = {
      message?: string;
    };

    const middlewareWithConfig = defineMiddleware({
      id: "middleware.config",
      run: async (input, deps, config: MiddlewareConfig) => {
        return input;
      },
    });

    const middlewareWithOptionalConfig = defineMiddleware({
      id: "middleware.optional.config",
      run: async (input, deps, config: MiddlewareOptionalConfig) => {
        return input;
      },
    });

    const event = defineEvent<{ message: string }>({
      id: "event",
    });

    const eventWithoutArguments = defineEvent({
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
    const dummyResourceOptionalConfig = defineResource({
      id: "dummy.resource",
      init: async (config?: string) => "Resource Value",
    });

    const testResource = defineResource({
      id: "test.resource",
      middleware: [
        middleware,
        // @ts-expect-error
        middlewareWithConfig,
        middlewareWithConfig.with({ message: "Hello, World!" }),
        // @ts-expect-error
        middlewareWithConfig.with({ message: 123 }),
        middlewareWithOptionalConfig,
        middlewareWithOptionalConfig.with({ message: "Hello, World!" }),
        // @ts-expect-error
        middlewareWithOptionalConfig.with({ message: 123 }),
      ],
      dependencies: { task, dummyResource, event, eventWithoutArguments },
      init: async (_, deps) => {
        const result = await deps.task({
          message: "Hello, World!",
        });

        deps.event({ message: "Hello, World!" });
        // @ts-expect-error
        deps.event();
        // @ts-expect-error
        deps.event({ messagex: "Hello, World!" });
        deps.eventWithoutArguments();
        deps.eventWithoutArguments({});
        // @ts-expect-error
        deps.eventWithoutArguments({ something: false });

        // @ts-expect-error
        deps.dummyResource as number;

        deps.dummyResource as string;

        // @ts-expect-error
        result === 1;

        // @ts-expect-error
        deps.task2;
      },
      register: [
        middleware,
        middlewareWithConfig,
        middlewareWithOptionalConfig,
        middlewareWithOptionalConfig.with({ message: "Hello, World!" }),
        middlewareWithConfig.with({ message: "Hello, World!" }),
        // @ts-expect-error
        middlewareWithConfig.with({ message: 123 }),
        dummyResourceNoConfig,
        // @ts-expect-error
        dummyResourceNoConfig.with("hello"),
        // @ts-expect-error
        dummyResourceNoConfig.with({ anyObject: true }),

        // @ts-expect-error
        dummyResource, // should throw
        dummyResource.with({ ok: true }),
        // @ts-expect-error
        dummyResource.with({ ok: 123 }),
        // @ts-expect-error
        dummyResource.with(),

        // should work
        dummyResourceOptionalConfig.with("hello"),
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

    const testResource = defineTask({
      id: "test.resource",
      dependencies: { task },
      on: hookEvent,
      run: async (_, deps) => {
        _.data.message;
        // @ts-expect-error
        _.data.messagex;
        deps.task();
        // @ts-expect-error
        deps.task2;
      },
    });

    const testResource2 = defineTask({
      id: "test.resource",
      dependencies: { task },
      on: "*",
      run: async (_, deps) => {
        _.data.message;
        _.data.messagex;
        deps.task();
        // @ts-expect-error
        deps.task2;
      },
    });

    expect(true).toBe(true);
  });

  it("createTestResource.runTask: should be type-safe", async () => {
    type Input = { x: number };
    type Output = Promise<number>;

    const add = defineTask<Input, Output>({
      id: "types.add",
      run: async (i) => i.x + 1,
    });

    const depTask = defineTask<{ v: string }, Promise<string>>({
      id: "types.dep",
      run: async (i) => i.v.toUpperCase(),
    });

    const main = defineTask<Input, Output, { depTask: typeof depTask }>({
      id: "types.main",
      dependencies: { depTask },
      run: async (i, d) => {
        const v = await d.depTask({ v: String(i.x) });
        return Number(v) + 1;
      },
    });

    const app = defineResource({
      id: "types.app",
      register: [add, depTask, main],
    });
    const harness = createTestResource(app);

    // Types: input must match, override deps must match, output is awaited number
    const { value: t } = await (await import("../run")).run(harness);
    const r1: number | undefined = await t.runTask(add, { x: 1 });
    // @ts-expect-error wrong input type
    await t.runTask(add, { z: 1 });
    // @ts-expect-error missing input
    await t.runTask(add);

    const r2: number | undefined = await t.runTask(main, { x: 2 });

    // @ts-expect-error wrong deps override type
    await t.runTask(main, { x: 2 }, { depTask: async (i: number) => "x" });

    expect(true).toBe(true);
  });

  it("should have propper type safety for overrides", async () => {
    const task = defineTask({
      id: "task",
      run: async () => "Task executed",
    });

    // @ts-expect-error
    const overrideTask = defineOverride(task, {
      run: async () => 234,
    });

    const resource = defineResource({
      id: "resource",
      register: [task],
      init: async () => "Resource executed",
    });

    const overrideResource = defineOverride(resource, {
      init: async () => "Resource overridden",
    });
    // @ts-expect-error
    defineOverride(resource, {
      init: async () => 123, // bad type
    });

    const middleware = defineMiddleware({
      id: "middleware",
      run: async () => "Middleware executed",
    });

    expect(true).toBe(true);
  });

  it("should have propper type safety for tags", async () => {
    const tag = defineTag({ id: "tag" });
    const tag2 = defineTag<{ value: number }>({ id: "tag2" });
    const tag2optional = defineTag<{ value?: number }>({ id: "tag2" });

    const tag3 = tag2.with({ value: 123 });
    // @ts-expect-error
    const tag4 = tag.with({ value: 123 });

    const task = defineTask({
      id: "task",
      meta: {
        tags: [
          tag,
          // @ts-expect-error
          tag2,
          tag2optional,
          tag2.with({ value: 123 }),
          tag3,
        ],
      },
      run: async (input) => {
        return input;
      },
    });

    expect(true).toBe(true);
  });

  it("should enforce contracts on tasks", async () => {
    interface IUser {
      name: string;
    }

    interface IOther {
      age: number;
    }

    const tag = defineTag<{ value: number }, IUser>({ id: "tag" });
    const tag2 = defineTag<void, IOther>({ id: "tag2" });

    const meta = {
      tags: [tag.with({ value: 123 }), tag2],
    } satisfies IMeta;

    const response = {
      age: 123,
      name: "123", // intentional
    };
    type TEST = HasContracts<typeof meta>;
    type TEST2 = EnsureResponseSatisfiesContracts<typeof meta, typeof response>;

    const task = defineTask({
      id: "task",
      meta,
      run: async (input: { name: string }) => {
        return {
          age: 123,
          name: "123",
        };
      },
    });
  });
});
