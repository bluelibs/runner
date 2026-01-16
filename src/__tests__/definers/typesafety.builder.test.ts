import { r, run } from "../..";
import type { TagType } from "../..";
import z from "zod";
import { isOneOf, onAnyOf } from "../../types/event";

// This suite mirrors src/__tests__/typesafety.test.ts but uses ONLY builders (r.*)
// It is skipped because it primarily asserts compile-time TypeScript behavior via @ts-expect-error.
// eslint-disable-next-line jest/no-disabled-tests
describe.skip("builders typesafety", () => {
  it("tasks, resources: should have proper type safety for dependencies", async () => {
    type InputTask = {
      message: string;
    };

    const middlewareTaskOnly = r.middleware
      .task("middleware")
      .run(async ({ next, task }, deps) => {
        return task.input;
      })
      .build();

    type MiddlewareConfig = {
      message: string;
    };

    type MiddlewareOptionalConfig = {
      message?: string;
    };

    const middlewareWithConfig = r.middleware
      .task("middleware.config")
      .configSchema<MiddlewareConfig>({ parse: (x: any) => x })
      .run(async ({ next }, deps, config: MiddlewareConfig) => {
        return next();
      })
      .build();

    const middlewareWithOptionalConfig = r.middleware
      .task("middleware.optional.config")
      .configSchema<MiddlewareOptionalConfig>({ parse: (x: any) => x })
      .run(async ({ next }, deps, config: MiddlewareOptionalConfig) => {
        return next();
      })
      .build();

    const event = r
      .event("event")
      .payloadSchema<{ message: string }>({ parse: (x: any) => x })
      .build();

    const eventWithoutArguments = r.event("event.noargs").build();

    const baseTask = r
      .task("task.base")
      .inputSchema<InputTask>({ parse: (x: any) => x })
      .run(async (input: InputTask) => "Task executed")
      .build();

    const task = r
      .task("task")
      .dependencies({ baseTask, event })
      .inputSchema<InputTask>({ parse: (x: any) => x })
      .run(async (input, deps) => {
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
      })
      .build();

    type ResourceType = {
      ok: boolean;
    };

    const dummyResource = r
      .resource<ResourceType>("dummy.resource")
      .configSchema<ResourceType>({ parse: (x: any) => x })
      .init(async (config: ResourceType) => "Resource Value")
      .build();

    const dummyResourceNoConfig = r
      .resource("dummy.resource.noconfig")
      .init(async () => "Resource Value")
      .build();

    const dummyResourceOptionalConfig = r
      .resource<string | undefined>("dummy.resource.optional.config")
      .configSchema<string | undefined>({ parse: (x: any) => x })
      .init(async (config?: string) => "Resource Value")
      .build();

    const testResource3 = r
      .resource("test.resource3")
      .init(async (_: { name: string }) => {
        return "OK";
      })
      .build();

    const testResource = r
      .resource("test.resource")
      .middleware([])
      .dependencies({ task, dummyResource, event, eventWithoutArguments })
      .register([
        testResource3.with({ name: "Hello, World!" }),
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
        // @ts-expect-error should be invalid to register resource requiring config without .with()
        dummyResource,
        dummyResourceOptionalConfig.with("hello"),
      ])
      .build();

    expect(true).toBe(true);
  });

  it("events: should have proper type safety", async () => {
    const hookEvent = r
      .event("hook.event")
      .payloadSchema<{ message: string }>({ parse: (x: any) => x })
      .build();

    const task = r
      .task("task")
      .run(async () => "Task executed")
      .build();

    const testHook = r
      .hook("test.hook")
      .dependencies({ task })
      .on(hookEvent)
      .run(async (ev, deps) => {
        ev.data.message;
        // @ts-expect-error
        ev.data.messagex;
        deps.task();
        // @ts-expect-error
        deps.task2x;
      })
      .build();

    const testHook2 = r
      .hook("test.hook2")
      .dependencies({ task })
      .on("*")
      .run(async (ev, deps) => {
        ev.data.message;
        ev.data.messagex;
        deps.task();
        // @ts-expect-error
        deps.task2x;
      })
      .build();

    expect(true).toBe(true);
  });

  it("events: should infer common payload for multi-event hooks", async () => {
    const e1 = r
      .event("e1")
      .payloadSchema<{ a: string; b: number; common: number }>({
        parse: (x: any) => x,
      })
      .build();
    const e2 = r
      .event("e2")
      .payloadSchema<{ a: string; c: boolean; common: number }>({
        parse: (x: any) => x,
      })
      .build();
    const e3 = r
      .event("e3")
      .payloadSchema<{ a: string; b: number; d?: string; common: number }>({
        parse: (x: any) => x,
      })
      .build();

    r.hook("hook.common")
      .on([e1, e2, e3] as const)
      .run(async (ev) => {
        ev.data.a;
        ev.data.common;
        // @ts-expect-error b is not common to all
        ev.data.b;
        // @ts-expect-error c is not common to all
        ev.data.c;
      })
      .build();

    r.hook("hook.helper")
      .on(onAnyOf(e1, e3))
      .run(async (ev) => {
        ev.data.a;
        ev.data.common;
        // @ts-expect-error c is not common to all
        ev.data.c;
        // @ts-expect-error d is not common to all
        ev.data.d;
      })
      .build();

    r.hook("hook.guard")
      .on([e1, e2])
      .run(async (ev) => {
        if (isOneOf(ev, [e2, e1])) {
          ev.data.a;
          ev.data.common;
          // @ts-expect-error c not present in either
          ev.data.c;
          // @ts-expect-error b not common
          ev.data.b;
        }
      })
      .build();

    expect(true).toBe(true);
  });

  it("RunResult.runTask: should be type-safe", async () => {
    type Input = { x: number };
    type Output = Promise<number>;

    const add = r
      .task("types.add")
      .inputSchema<Input>({ parse: (x: any) => x })
      .run(async (i: Input) => i.x + 1)
      .build();

    const depTask = r
      .task("types.dep")
      .inputSchema<{ v: string }>({ parse: (x: any) => x })
      .run(async (input) => input.v.toUpperCase())
      .build();

    const main = r
      .task("types.main")
      .dependencies({ depTask })
      .inputSchema<Input>({ parse: (x: any) => x })
      .run(async (input, deps) => {
        const v = await deps.depTask({ v: String(input.x) });
        return Number(v) + 1;
      })
      .build();

    const app = r.resource("types.app").register([add, depTask, main]).build();
    const harness = r.resource("types.harness").register([app]).build();

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

  it("should have proper type safety for tags", async () => {
    const tag = r.tag("tag").build();
    const tag2 = r.tag<{ value: number }>("tag2").build();
    const tag2optional = r.tag<{ value?: number }>("tag2").build();
    const tag3 = tag2.with({ value: 123 });

    const task = r
      .task("task")
      .tags([
        tag,
        // @ts-expect-error
        tag2,
        tag2optional,
        tag2.with({ value: 123 }),
        // @ts-expect-error
        tag2.with({ value: "123" }),
        tag3,
      ])
      .meta({} as Record<string, any>)
      .run(async (input) => {
        return input;
      })
      .build();

    expect(true).toBe(true);
  });

  it("should enforce contracts on tasks and resources (via tags)", async () => {
    interface IUser {
      name: string;
    }

    interface IOther {
      age: number;
    }

    const tag = r.tag<{ value: number }, void, IUser>("tag").build();
    const tag2 = r.tag<void, void, IOther>("tag2").build();
    const tag3WithInputContract = r
      .tag<void, { a: string }, void>("tag3")
      .build();

    const tags = [tag.with({ value: 123 }), tag2] satisfies TagType[];

    const task = r
      .task("task")
      .tags(tags)
      .inputSchema<{ name: string }>({ parse: (x: any) => x })
      // @ts-expect-error ensure result contract is enforced
      .run(async (input: { name: string }) => {
        return {
          age: 123,
        };
      })
      .build();
    const task2 = r
      .task("task2")
      .tags(tags)
      // @ts-expect-error invalid result contract
      .run(async (input: { name: string }) => {
        return {
          age: "123",
        };
      })
      .build();

    const task3 = r
      .task("task3")
      .tags(tags)
      // @ts-expect-error invalid result contract
      .run(async (input: { name: string }) => {
        return {};
      })
      .build();

    const task4 = r
      .task("task4")
      .tags([tag3WithInputContract])
      .run(async (input) => {
        input.a;
        // @ts-expect-error
        input.b;
        return {
          age: 123,
          name: "123",
        };
      })
      .build();

    const resource4 = r
      .resource("resource")
      .tags([tag3WithInputContract])
      .init(async (config) => {
        config.a;
        // @ts-expect-error
        config.b;
      })
      .build();

    const resource5 = r
      .resource<{ a: string }>("resource5")
      .init(async (config) => {
        config.a;
        // @ts-expect-error
        config.b;
      })
      .build();

    const resource6 = r
      .resource("resource6")
      .init(async (config: { a: string }) => {
        config.a;
        // @ts-expect-error
        config.b;
      })
      .build();
  });

  it("should correctly infer schemas from validation options", async () => {
    const task = r
      .task("task")
      .inputSchema(z.object({ name: z.string() }))
      .resultSchema(z.object({ name: z.string() }))
      .run(async (input) => {
        input.name;
        // @ts-expect-error
        input.age;

        return {
          name: "123",
        };
      })
      .build();

    const mw = r.middleware
      .task("middleware")
      .configSchema(z.object({ ttl: z.number().positive() }))
      .run(async ({ next }, deps, config) => {
        config.ttl;
        // @ts-expect-error
        config.ttl2;
      })
      .build();

    const resource = r
      .resource("resource")
      .configSchema(z.object({ ttl: z.number().positive() }))
      .init(async (cfg) => {
        cfg.ttl;
        // @ts-expect-error
        cfg.ttl2;
      })
      .build();

    expect(true).toBe(true);
  });

  it("should work correctly with middleware and contracts", async () => {
    type InputType = { id: string };
    type OutputType = { name: string };
    type ConfigType = { ttl: number };
    const mw = r.middleware
      .task<ConfigType, InputType, OutputType>("mw")
      .run(async ({ next }, deps, config) => {
        // @ts-expect-error
        next({ id: 123 });
        // @ts-expect-error
        next({ name: "123" });
        return next({ id: "123" });
      })
      .build();

    const t1 = r
      .task("t1")
      .inputSchema(z.object({ id: z.string() }))
      .middleware([mw.with({ ttl: 123 })])
      .run(async (input) => {
        input.id;
        // @ts-expect-error
        input.name;
        return { name: "123" };
      })
      .build();

    expect(true).toBe(true);
  });
});
