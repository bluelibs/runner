import {
  Match,
  defineAsyncContext,
  defineEvent,
  defineResource,
  defineResourceMiddleware,
  r,
  run,
  defineTag,
  defineTask,
  defineTaskMiddleware,
} from "../..";
import { defineError } from "../../definers/defineError";

class DecoratedSchema {
  value!: string;
}

Match.Schema()(DecoratedSchema);
Match.Field(String)(DecoratedSchema.prototype, "value");

class UndecoratedSchema {
  value!: string;
}

describe("decorator schema shorthand", () => {
  it("prefers explicit parse schemas over class/decorator fallback", async () => {
    const parse = jest.fn((input: unknown) => ({
      value: `parsed:${String(input)}`,
    }));

    const task = defineTask({
      id: "tests.decorator.precedence.task",
      inputSchema: { parse },
      run: async (input) => input,
    });

    const app = defineResource({
      id: "tests.decorator.precedence.app",
      register: [task],
    });
    const runtime = await run(app);

    const result = await runtime.runTask(task, "raw" as any);
    expect(result).toEqual({ value: "parsed:raw" });
    expect(parse).toHaveBeenCalledTimes(1);

    await runtime.dispose();
  });

  it("rejects undecorated class shorthand fail-fast", () => {
    expect(() =>
      defineTask({
        id: "tests.decorator.fail-fast.task",
        inputSchema: UndecoratedSchema,
        run: async (_input) => undefined,
      }),
    ).toThrow("@Match.Schema()");
  });

  it("normalizes class shorthand for all non-fluent and fluent schema surfaces", async () => {
    const task = defineTask({
      id: "tests.decorator.nonfluent.task",
      inputSchema: DecoratedSchema,
      run: async (input: { value: string }) => input.value,
    });

    const event = defineEvent({
      id: "tests.decorator.nonfluent.event",
      payloadSchema: DecoratedSchema,
    });

    const taskMw = defineTaskMiddleware({
      id: "tests.decorator.nonfluent.task-mw",
      configSchema: DecoratedSchema,
      run: async ({ next, task: taskInput }) => next(taskInput.input),
    });

    const resourceMw = defineResourceMiddleware({
      id: "tests.decorator.nonfluent.resource-mw",
      configSchema: DecoratedSchema,
      run: async ({ next, resource: resourceInput }) =>
        next(resourceInput.config),
    });

    const tag = defineTag({
      id: "tests.decorator.nonfluent.tag",
      configSchema: DecoratedSchema,
    });

    const asyncContext = defineAsyncContext({
      id: "tests.decorator.nonfluent.ctx",
      configSchema: DecoratedSchema,
    });

    const TypedError = defineError<{ value: string }>({
      id: "tests.decorator.nonfluent.error",
      dataSchema: DecoratedSchema,
      format: (data) => data.value,
    });

    const cfgResource = defineResource({
      id: "tests.decorator.nonfluent.resource",
      configSchema: DecoratedSchema,
      init: async (config: { value: string }) => config.value,
    });

    expect(typeof task.inputSchema?.parse).toBe("function");
    expect(typeof event.payloadSchema?.parse).toBe("function");
    expect(typeof taskMw.configSchema?.parse).toBe("function");
    expect(typeof resourceMw.configSchema?.parse).toBe("function");
    expect(typeof tag.configSchema?.parse).toBe("function");
    expect(typeof asyncContext.configSchema?.parse).toBe("function");
    expect(typeof cfgResource.configSchema?.parse).toBe("function");

    expect(() => taskMw.with({ value: 1 } as any)).toThrow();
    expect(() => resourceMw.with({ value: 1 } as any)).toThrow();
    expect(() => tag.with({ value: 1 } as any)).toThrow();
    expect(() =>
      asyncContext.provide({ value: 1 } as any, () => undefined),
    ).toThrow();
    expect(() => TypedError.new({ value: 1 } as any)).toThrow();
    expect(() => cfgResource.with({ value: 1 } as any)).toThrow();

    const hook = r
      .hook("tests.decorator.nonfluent.hook")
      .on(event)
      .run(async () => undefined)
      .build();

    const app = defineResource({
      id: "tests.decorator.nonfluent.app",
      register: [task, event, hook],
    });
    const runtime = await run(app);

    await expect(runtime.runTask(task, { value: "ok" })).resolves.toBe("ok");
    await expect(runtime.runTask(task, { value: 1 } as any)).rejects.toThrow();

    await expect(
      runtime.emitEvent(event, { value: "ok" }),
    ).resolves.toBeUndefined();
    await expect(
      runtime.emitEvent(event, { value: 1 } as any),
    ).rejects.toThrow();

    const fluentTask = r
      .task("tests.decorator.fluent.task")
      .inputSchema(DecoratedSchema)
      .run(async (input: { value: string }) => input.value)
      .build();

    const fluentResource = r
      .resource("tests.decorator.fluent.resource")
      .configSchema(DecoratedSchema)
      .init(async (config: { value: string }) => config.value)
      .build();

    const fluentEvent = r
      .event("tests.decorator.fluent.event")
      .payloadSchema(DecoratedSchema)
      .build();

    const fluentTaskMw = r.middleware
      .task("tests.decorator.fluent.task-mw")
      .configSchema(DecoratedSchema)
      .run(async ({ next, task: taskInput }) => next(taskInput.input))
      .build();

    const fluentResourceMw = r.middleware
      .resource("tests.decorator.fluent.resource-mw")
      .configSchema(DecoratedSchema)
      .run(async ({ next, resource: resourceInput }) =>
        next(resourceInput.config),
      )
      .build();

    const fluentTag = r
      .tag("tests.decorator.fluent.tag")
      .configSchema(DecoratedSchema)
      .build();

    const fluentAsyncContext = r
      .asyncContext<{ value: string }>("tests.decorator.fluent.ctx")
      .configSchema(DecoratedSchema)
      .build();

    const FluentError = r
      .error<{ value: string }>("tests.decorator.fluent.error")
      .dataSchema(DecoratedSchema)
      .format((data) => data.value)
      .build();

    expect(typeof fluentTask.inputSchema?.parse).toBe("function");
    expect(typeof fluentResource.configSchema?.parse).toBe("function");
    expect(typeof fluentEvent.payloadSchema?.parse).toBe("function");
    expect(typeof fluentTaskMw.configSchema?.parse).toBe("function");
    expect(typeof fluentResourceMw.configSchema?.parse).toBe("function");
    expect(typeof fluentTag.configSchema?.parse).toBe("function");
    expect(typeof fluentAsyncContext.configSchema?.parse).toBe("function");
    expect(() => FluentError.new({ value: 1 } as any)).toThrow();

    await runtime.dispose();
  });
});
