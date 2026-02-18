import { r, run } from "../..";

describe("schema aliases coverage", () => {
  it("supports schema aliases on task/resource/task-middleware/resource-middleware", async () => {
    let taskParsed = false;
    let resourceParsed = false;

    const taskMiddleware = r.middleware
      .task<{ enabled: boolean }>("tests.alias.schema.task-mw")
      .schema<{ enabled: boolean }>({
        parse: (input: unknown) => input as { enabled: boolean },
      })
      .run(async ({ next, task }) => next(task.input))
      .build();

    const resourceMiddleware = r.middleware
      .resource<{ enabled: boolean }>("tests.alias.schema.resource-mw")
      .schema<{ enabled: boolean }>({
        parse: (input: unknown) => input as { enabled: boolean },
      })
      .run(async ({ next, resource }) => next(resource.config))
      .build();

    const calc = r
      .task("tests.alias.schema.task")
      .schema<{ value: number }>({
        parse: (input: unknown) => {
          taskParsed = true;
          return input as { value: number };
        },
      })
      .middleware([taskMiddleware.with({ enabled: true })])
      .run(async (input) => input.value * 2)
      .build();

    const service = r
      .resource("tests.alias.schema.resource")
      .schema<{ port: number }>({
        parse: (input: unknown) => {
          resourceParsed = true;
          return input as { port: number };
        },
      })
      .middleware([resourceMiddleware.with({ enabled: true })])
      .init(async (config) => ({ port: config.port }))
      .build();

    const app = r
      .resource("tests.alias.schema.app")
      .register([
        calc,
        service.with({ port: 3000 }),
        taskMiddleware,
        resourceMiddleware,
      ])
      .dependencies({ calc, service })
      .init(async (_config, deps) => ({
        answer: await deps.calc({ value: 2 }),
        port: deps.service.port,
      }))
      .build();

    const runtime = await run(app);
    expect(taskParsed).toBe(true);
    expect(resourceParsed).toBe(true);
    expect(runtime.getRootValue<{ answer: number; port: number }>()).toEqual({
      answer: 4,
      port: 3000,
    });
    await runtime.dispose();
  });

  it("keeps task.resultSchema() separate from task.schema()", async () => {
    let inputParsed = false;
    let resultParsed = false;

    const task = r
      .task("tests.alias.schema.task.result")
      .schema<{ value: number }>({
        parse: (input: unknown) => {
          inputParsed = true;
          return input as { value: number };
        },
      })
      .resultSchema<{ doubled: number }>({
        parse: (input: unknown) => {
          resultParsed = true;
          return input as { doubled: number };
        },
      })
      .run(async (input) => ({ doubled: input.value * 2 }))
      .build();

    const app = r
      .resource("tests.alias.schema.task.result.app")
      .register([task])
      .build();

    const runtime = await run(app);
    const output = await runtime.runTask(task, { value: 2 });
    expect(output).toEqual({ doubled: 4 });
    expect(inputParsed).toBe(true);
    expect(resultParsed).toBe(true);
    await runtime.dispose();
  });

  it("supports event.schema(), event.throws(), and asyncContext.schema()", async () => {
    const AppError = r
      .error<{ code: number }>("tests.alias.event.error")
      .build();

    const event = r
      .event("tests.alias.event")
      .schema<{ name: string }>({
        parse: (input: unknown) => input as { name: string },
      })
      .throws([AppError])
      .build();

    const requestContext = r
      .asyncContext<{ requestId: string }>("tests.alias.ctx")
      .schema({
        parse: (input: unknown) => input as { requestId: string },
      })
      .build();

    const seen: string[] = [];
    const hook = r
      .hook("tests.alias.event.hook")
      .on(event)
      .run(async (emission) => {
        seen.push(emission.data.name);
      })
      .build();

    const task = r
      .task("tests.alias.event.task")
      .dependencies({ event, requestContext })
      .run(async (_input, deps) =>
        deps.requestContext.provide({ requestId: "r-1" }, async () => {
          const id = deps.requestContext.use().requestId;
          await deps.event({ name: id });
          return id;
        }),
      )
      .build();

    const app = r
      .resource("tests.alias.event.app")
      .register([event, requestContext, hook, task])
      .build();

    const runtime = await run(app);
    const value = await runtime.runTask(task);
    expect(value).toBe("r-1");
    expect(seen).toEqual(["r-1"]);
    await runtime.dispose();
  });

  it("supports tag.schema() and error.schema()/error.tags()/error.meta()", () => {
    const metaTag = r.tag("tests.alias.tags.meta").build();

    const featureTag = r
      .tag<{ scope: string }>("tests.alias.tags.feature")
      .schema<{ scope: string }>({
        parse: (input: unknown) => input as { scope: string },
      })
      .build();
    expect(featureTag.id).toBe("tests.alias.tags.feature");

    const TypedError = r
      .error<{ code: number }>("tests.alias.errors.typed")
      .schema({
        parse: (input: unknown) => input as { code: number },
      })
      .tags([metaTag])
      .tags([metaTag], { override: true })
      .meta({ title: "Typed Error" })
      .build();

    expect(TypedError.tags).toEqual([metaTag]);
    expect(TypedError.meta).toEqual({ title: "Typed Error" });

    const DefaultError = r.error("tests.alias.errors.default").build();
    expect(DefaultError.tags).toEqual([]);
    expect(DefaultError.meta).toEqual({});
  });

  it("skips invalid middleware/hook dependency nodes during dependency-graph building", async () => {
    const event = r.event("tests.alias.graph.event").build();

    const taskMiddleware = r.middleware
      .task("tests.alias.graph.task-mw")
      .dependencies({
        // @ts-expect-error coverage: intentionally invalid dependency value
        skipped: undefined,
      })
      .run(async ({ next, task }) => next(task.input))
      .build();

    const resourceMiddleware = r.middleware
      .resource("tests.alias.graph.resource-mw")
      .dependencies({
        // @ts-expect-error coverage: intentionally invalid dependency value
        skipped: undefined,
      })
      .run(async ({ next, resource }) => next(resource.config))
      .build();

    const hook = r
      .hook("tests.alias.graph.hook")
      .on(event)
      .dependencies({
        // @ts-expect-error coverage: intentionally invalid dependency value
        skipped: undefined,
      })
      .run(async () => undefined)
      .build();

    const task = r
      .task("tests.alias.graph.task")
      .middleware([taskMiddleware])
      .run(async () => "ok")
      .build();

    const app = r
      .resource("tests.alias.graph.app")
      .register([event, hook, taskMiddleware, resourceMiddleware, task])
      .middleware([resourceMiddleware])
      .dependencies({ task, event })
      .init(async (_config, deps) => {
        await deps.task();
        await deps.event();
        return "ready";
      })
      .build();

    const runtime = await run(app);
    expect(runtime.getRootValue<string>()).toBe("ready");
    await runtime.dispose();
  });
});
