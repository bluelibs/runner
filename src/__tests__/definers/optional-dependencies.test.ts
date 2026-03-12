import {
  defineEvent,
  defineHook,
  defineResource,
  defineResourceMiddleware,
  defineTask,
  defineTaskMiddleware,
} from "../../define";
import { run, definitions } from "../../index";

describe("Optional dependencies", () => {
  test("task.optional() missing should resolve to undefined in resource deps", async () => {
    const app = defineResource({
      id: "tests-optional-task-missing",
      dependencies: {
        maybeTask: defineTask({
          id: "tests-optional-task",
          async run() {
            return "unused" as const;
          },
        }).optional(),
      },
      async init(_config, deps) {
        expect(deps.maybeTask).toBeUndefined();
        return "ok" as const;
      },
    });

    const { value } = await run(app);
    expect(value).toBe("ok");
  });

  test("task.optional() present should resolve to callable with intercept()", async () => {
    const t = defineTask({
      id: "tests-optional-present-task",
      async run() {
        return "result" as const;
      },
    });

    const registrar = defineResource({
      id: "tests-optional-task-registrar",
      register: [t],
      async init() {
        return "ready" as const;
      },
    });

    const app = defineResource({
      id: "tests-optional-task-user",
      register: [registrar],
      dependencies: {
        maybeTask: t.optional(),
      },
      async init(_config, deps) {
        expect(typeof deps.maybeTask).toBe("function");
        // Has intercept() available
        expect(
          typeof (deps.maybeTask as unknown as { intercept: unknown })
            .intercept,
        ).toBe("function");
        expect(
          typeof (
            deps.maybeTask as unknown as {
              getInterceptingResourceIds: unknown;
            }
          ).getInterceptingResourceIds,
        ).toBe("function");
        expect(
          (
            deps.maybeTask as unknown as {
              getInterceptingResourceIds: () => readonly string[];
            }
          ).getInterceptingResourceIds(),
        ).toEqual([]);
        const out = await (
          deps.maybeTask as unknown as () => Promise<string>
        )();
        expect(out).toBe("result");
        return "done" as const;
      },
    });

    const { value } = await run(app);
    expect(value).toBe("done");
  });

  test("resource.optional() missing should resolve to undefined in resource deps", async () => {
    const res = defineResource({ id: "tests-optional-resource" });

    const app = defineResource({
      id: "tests-optional-resource-user",
      dependencies: {
        maybeRes: res.optional(),
      },
      async init(_config, deps) {
        expect(deps.maybeRes).toBeUndefined();
        return "ok" as const;
      },
    });

    const { value } = await run(app);
    expect(value).toBe("ok");
  });

  test("resource.optional() present should resolve to resource value", async () => {
    const res = defineResource({
      id: "tests-optional-resource-present",
      async init() {
        return 42 as const;
      },
    });

    const registrar = defineResource({
      id: "tests-optional-resource-registrar",
      register: [res],
      async init() {
        return "ready" as const;
      },
    });

    const app = defineResource({
      id: "tests-optional-resource-user2",
      register: [registrar],
      dependencies: {
        maybeRes: res.optional(),
      },
      async init(_config, deps) {
        expect(deps.maybeRes).toBe(42);
        return "ok" as const;
      },
    });

    const { value } = await run(app);
    expect(value).toBe("ok");
  });

  test("fails fast when subtree middleware depends on an optional-wrapped target task", async () => {
    const target = defineTask({
      id: "tests-optional-middleware-target",
      async run() {
        return "x" as const;
      },
    });

    const mw = defineTaskMiddleware({
      id: "tests-optional-middleware",
      dependencies: {
        target: target.optional(),
      },
      async run({ task, next }) {
        if (task?.definition.id === target.id) {
          return next();
        }
        return next();
      },
    });

    const app = defineResource({
      id: "tests-optional-middleware-app",
      subtree: {
        tasks: {
          middleware: [mw],
        },
      },
      register: [target, mw],
    });

    await expect(run(app)).rejects.toThrow(/Circular dependencies detected/);
  });

  test("event.optional() missing should resolve to undefined", async () => {
    const ev = defineEvent({ id: "tests-optional-event-missing" });
    const app = defineResource({
      id: "tests-optional-event-user",
      dependencies: {
        maybeEvent: ev.optional(),
      },
      async init(_config, deps) {
        expect(deps.maybeEvent).toBeUndefined();
        return "ok" as const;
      },
    });
    const { value } = await run(app);
    expect(value).toBe("ok");
  });

  test("event.optional() present should resolve to emit function", async () => {
    const ev = defineEvent<{ v: number }>({
      id: "tests-optional-event-present",
    });
    const registrar = defineResource({
      id: "tests-optional-event-registrar",
      register: [ev],
      async init() {
        return "rdy" as const;
      },
    });
    const app = defineResource({
      id: "tests-optional-event-user2",
      register: [registrar],
      dependencies: { maybeEvent: ev.optional() },
      async init(_config, deps) {
        expect(typeof deps.maybeEvent).toBe("function");
        await deps.maybeEvent!({ v: 1 });
        return "ok" as const;
      },
    });
    const { value } = await run(app);
    expect(value).toBe("ok");
  });

  test("optional wrapper with invalid inner throws UnknownItemTypeError", async () => {
    const badWrapper: unknown = {
      inner: { nope: true },
      [definitions.symbolOptionalDependency]: true,
    };

    const app = defineResource({
      id: "tests-optional-invalid",
      dependencies: {
        // @ts-expect-error
        bad: badWrapper,
      },
      async init() {
        return "never";
      },
    });

    await expect(run(app)).rejects.toMatchObject({
      id: "runner.errors.unknownItemType",
    });
  });

  test("getDependentNodes accounts for optional deps in tasks and resources", async () => {
    const depTask = defineTask({
      id: "tests-optional-graph-depTask",
      async run() {
        return "y" as const;
      },
    });
    const usesTask = defineTask({
      id: "tests-optional-graph-usesTask",
      dependencies: { dep: depTask.optional() },
      async run(_input, deps) {
        return (await deps.dep?.()) ?? "missing-task-dep";
      },
    });

    const depRes = defineResource({
      id: "tests-optional-graph-depRes",
      async init() {
        return "resource-value" as const;
      },
    });
    const usesRes = defineResource({
      id: "tests-optional-graph-usesRes",
      dependencies: { r: depRes.optional() },
      async init(_config, deps) {
        return deps.r ?? "missing-resource-dep";
      },
    });

    const app = defineResource({
      id: "tests-optional-graph-app",
      register: [depTask, usesTask, depRes, usesRes],
      async init() {
        return "ready" as const;
      },
    });
    const harness = defineResource({
      id: "tests-optional-graph-harness",
      register: [app],
    });
    const rr = await run(harness);
    await expect(rr.runTask(usesTask)).resolves.toBe("y");
    expect(rr.getResourceValue(usesRes)).toBe("resource-value");
    await rr.dispose();
  });

  it("task middleware should be able to depend on optional dependencies", async () => {
    const nonRegisteredResource = defineResource({
      id: "non-registered-resource",
      init: async () => true,
    });
    const nonRegisteredTask = defineTask({
      id: "non-registered-task",
      run: async () => "Task executed",
    });

    const registeredResource = defineResource({
      id: "registered-resource",
      init: async () => true,
    });
    const registeredTask = defineTask({
      id: "registered-task",
      run: async () => "Task executed",
    });

    const mw = defineTaskMiddleware({
      id: "everywhere-middleware",
      dependencies: {
        registeredResource,
        registeredTask,
        nonRegisteredResource: nonRegisteredResource.optional(),
        nonRegisteredTask: nonRegisteredTask.optional(),
      },
      run: async ({ next, task }, deps) => {
        expect(deps.registeredResource).toBeDefined();
        expect(deps.registeredTask).toBeDefined();
        expect(deps.nonRegisteredResource).toBeUndefined();
        expect(deps.nonRegisteredTask).toBeUndefined();
        return "Intercepted: " + (await next(task.input));
      },
    });

    const middlewarableTask = defineTask({
      id: "middlewarable-task",
      run: async (input: string) => input,
    });

    const scopedTasksResource = defineResource({
      id: "app-scoped-tasks",
      subtree: {
        tasks: {
          middleware: [mw],
        },
      },
      register: [middlewarableTask],
    });

    const app = defineResource({
      id: "app",
      register: [mw, registeredTask, registeredResource, scopedTasksResource],
    });

    const r = await run(app);
    const result = await r.runTask(middlewarableTask, "Task executed");
    expect(result).toBe("Intercepted: Task executed");
  });

  it("resource middleware should be able to depend on optional dependencies", async () => {
    const nonRegisteredResource = defineResource({
      id: "non-registered-resource",
      init: async () => true,
    });
    const nonRegisteredTask = defineTask({
      id: "non-registered-task",
      run: async () => "Task executed",
    });

    const registeredResource = defineResource({
      id: "registered-resource",
      init: async () => true,
    });
    const registeredTask = defineTask({
      id: "registered-task",
      run: async () => "Task executed",
    });

    const mw = defineResourceMiddleware({
      id: "everywhere-middleware",
      dependencies: {
        registeredResource,
        registeredTask,
        nonRegisteredResource: nonRegisteredResource.optional(),
        nonRegisteredTask: nonRegisteredTask.optional(),
      },
      run: async ({ next, resource: _resource }, deps) => {
        if (
          [registeredResource, nonRegisteredResource].some(
            (resourceDefinition) =>
              resourceDefinition.id === _resource.definition.id,
          )
        ) {
          return next();
        }
        expect(deps.registeredResource).toBeDefined();
        expect(deps.registeredTask).toBeDefined();
        expect(deps.nonRegisteredResource).toBeUndefined();
        expect(deps.nonRegisteredTask).toBeUndefined();
        return "Intercepted: " + (await next());
      },
    });

    const middlewarableResource = defineResource({
      id: "middlewarable-resource",
      init: async () => "Hello",
    });

    const scopedResourcesResource = defineResource({
      id: "app-scoped-resources",
      subtree: {
        resources: {
          middleware: [mw],
        },
      },
      register: [middlewarableResource],
    });

    const app = defineResource({
      id: "app",
      register: [
        mw,
        registeredTask,
        registeredResource,
        scopedResourcesResource,
      ],
    });

    const r = await run(app);
    const result = await r.getResourceValue(middlewarableResource);
    expect(result).toBe("Intercepted: Hello");
  });

  it("hooks should be able to depend on optional dependencies", async () => {
    const nonRegisteredResource = defineResource({
      id: "non-registered-resource",
      init: async () => true,
    });

    const registeredResource = defineResource({
      id: "registered-resource",
      init: async () => true,
    });

    const event = defineEvent({
      id: "event",
    });

    let inHook = false;
    const hook = defineHook({
      id: "hook",
      on: event,
      dependencies: {
        registeredResource: registeredResource,
        nonRegisteredResource: nonRegisteredResource.optional(),
      },
      run: async (_event, deps) => {
        expect(deps.registeredResource).toBeDefined();
        expect(deps.nonRegisteredResource).toBeUndefined();
        inHook = true;
      },
    });

    const app = defineResource({
      id: "app",
      register: [hook, registeredResource, event],
      dependencies: {
        event,
      },
      async init(_, { event }) {
        await event();
      },
    });

    await run(app);
    expect(inHook).toBe(true);
  });
});
