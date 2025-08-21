import {
  defineEvent,
  defineTask,
  defineResource,
  defineOverride,
  defineTag,
  defineHook,
  defineTaskMiddleware,
  defineResourceMiddleware,
} from "../define";
import { IMeta, TagType } from "../defs";
import { run } from "..";
import z from "zod";

// This is skipped because we mostly check typesafety.
describe.skip("typesafety", () => {
  it("tasks, resources: should have propper type safety for dependeices", async () => {
    type InputTask = {
      message: string;
    };

    const middlewareTaskOnly = defineTaskMiddleware({
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

    const middlewareWithConfig = defineTaskMiddleware({
      id: "middleware.config",
      run: async (input, deps, config: MiddlewareConfig) => {
        return input;
      },
    });

    const middlewareWithOptionalConfig = defineTaskMiddleware({
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
      middleware: [],
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
        middlewareTaskOnly,
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

    const testResource = defineHook({
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

    const testResource2 = defineHook({
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

  it("RunResult.runTask: should be type-safe", async () => {
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
    const harness = defineResource({ id: "types.harness", register: [app] });

    // Types: input must match, override deps must match, output is awaited number
    const rr = await run(harness);
    const r1: number | undefined = await rr.runTask(add, { x: 1 });
    // @ts-expect-error wrong input type
    await rr.runTask(add, { z: 1 });
    // @ts-expect-error missing input
    await rr.runTask(add);

    const r2: number | undefined = await rr.runTask(main, { x: 2 });

    // @ts-expect-error wrong deps override type
    await rr.runTask(main, { x: 2 }, { depTask: async (i: number) => "x" });

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

    const mwTask = defineTaskMiddleware({
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
      tags: [
        tag,
        // @ts-expect-error
        tag2,
        tag2optional,
        tag2.with({ value: 123 }),
        // @ts-expect-error
        tag2.with({ value: "123" }),
        tag3,
      ],
      meta: {},
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

    const tag = defineTag<{ value: number }, void, IUser>({ id: "tag" });
    const tag2 = defineTag<void, void, IOther>({ id: "tag2" });

    const tags = [tag.with({ value: 123 }), tag2] satisfies TagType[];

    const response = {
      age: 123,
      name: "123", // intentional
    };

    const task = defineTask({
      id: "task",
      tags,
      run: async (input: { name: string }) => {
        return {
          age: 123,
          name: "123",
        };
      },
    });
    const task2 = defineTask({
      id: "task",
      tags,
      // @ts-expect-error
      run: async (input: { name: string }) => {
        return {
          age: "123",
        };
      },
    });

    const task3 = defineTask({
      id: "task",
      tags,
      // @ts-expect-error
      run: async (input: { name: string }) => {
        return {};
      },
    });
  });

  it("should have contractable middleware", async () => {
    const mw = defineTaskMiddleware<
      void,
      { input: string },
      { output: number }
    >({
      id: "middleware",
      run: async ({ next, task }, deps, config) => {
        task.input;
        task.input.input;
        // @ts-expect-error
        task.input.a;
        next({ input: "123" });
        // @ts-expect-error
        next({ input: 123 });
        const outputResult = await next({ input: "123" });
        outputResult.output;
        // @ts-expect-error
        outputResult.output2;

        return {
          output: 123,
        };
      },
    });
    const mwWithConfig = defineTaskMiddleware<
      { ttl: number },
      { input: string },
      { output: number }
    >({
      id: "middleware",
      run: async ({ next }, deps, config) => {
        return {
          output: 123,
        };
      },
    });

    const mwr = defineResourceMiddleware<
      void,
      { input: string },
      { output: number }
    >({
      id: "middleware",
      run: async ({ next }, deps, config) => {},
    });

    const mwrWithConfig = defineResourceMiddleware<
      { ttl: number },
      { input: string },
      { output: number }
    >({
      id: "middleware",
      run: async ({ next }, deps, config) => {},
    });

    const mw2 = defineTaskMiddleware<void, { input: string }, void>({
      id: "middleware2",
      run: async ({ next }, deps, config) => {
        return {
          output: 123,
        };
      },
    });

    const mwr2 = defineResourceMiddleware<void, { input: string }, void>({
      id: "middleware2",
      run: async ({ next }, deps, config) => {},
    });

    const task = defineTask({
      id: "task",
      middleware: [mw],
      // @ts-expect-error
      run: async (input) => {
        input;
        // @ts-expect-error
        input.a;

        return {
          output: "str",
        };
      },
    });

    const resource = defineResource<{ input: string }>({
      id: "resource",
      middleware: [mwr, mwr2],
      init: async (config) => {
        config.input;
        // @ts-expect-error
        config.input2;

        return {
          output: 123,
        };
      },
    });

    const taskWithConfig = defineTask({
      id: "task",
      middleware: [
        // @ts-expect-error
        mwWithConfig,
        mwWithConfig.with({ ttl: 123 }),
        // @ts-expect-error
        mwWithConfig.with({ ttl: "123" }),
      ],
      run: async (input) => {
        input;
        // @ts-expect-error
        input.a;

        return {
          output: 123,
        };
      },
    });

    const resourceWithConfig = defineResource<{ input: string }>({
      id: "resource",
      middleware: [
        // @ts-expect-error
        mwrWithConfig,
        mwrWithConfig.with({ ttl: 123 }),
        // @ts-expect-error
        mwrWithConfig.with({ ttl: "123" }),
      ],
      init: async (config) => {
        config.input;
      },
    });
  });

  it("should enforce tags contracts on resources", async () => {
    interface IUser {
      name: string;
    }

    interface IOther {
      age: number;
    }

    const tag = defineTag<{ value: number }, void, IUser>({ id: "tag" });
    const tag2 = defineTag<void, void, IOther>({ id: "tag2" });

    const tags = [tag.with({ value: 123 }), tag2] satisfies TagType[];

    const resourceOk = defineResource({
      id: "resource.ok",
      tags,
      init: async () => {
        return {
          age: 123,
          name: "123",
        };
      },
    });

    const resourceBad1 = defineResource({
      id: "resource.bad1",
      tags,
      // @ts-expect-error
      init: async () => {
        return {
          age: "123",
          name: "123",
        };
      },
    });

    const resourceBad2 = defineResource({
      id: "resource.bad2",
      tags,
      // @ts-expect-error
      init: async () => {
        return {};
      },
    });
  });

  it("should correctly infer schemas from validation options", async () => {
    const task = defineTask({
      id: "task",
      inputSchema: z.object({ name: z.string() }),
      resultSchema: z.object({ name: z.string() }),
      run: async (input) => {
        input.name;
        // @ts-expect-error
        input.age;

        return {
          name: "123",
        };
      },
    });

    const mw = defineTaskMiddleware({
      id: "middleware",
      configSchema: z.object({ ttl: z.number().positive() }),
      run: async ({ next }, deps, config) => {
        config.ttl;
        // @ts-expect-error
        config.ttl2;
      },
    });

    const resource = defineResource({
      id: "resource",
      configSchema: z.object({ ttl: z.number().positive() }),
      init: async (cfg) => {
        cfg.ttl;
        // @ts-expect-error
        cfg.ttl2;
      },
    });

    expect(true).toBe(true);
  });
});
