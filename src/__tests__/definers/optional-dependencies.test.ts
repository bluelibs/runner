import {
  defineEvent,
  defineHook,
  defineResource,
  defineResourceMiddleware,
  defineTask,
  defineTaskMiddleware,
} from "../../define";
import { resource, task, run, event, definitions } from "../../index";

describe("Optional dependencies", () => {
  test("task.optional() missing should resolve to undefined in resource deps", async () => {
    const app = resource({
      id: "tests.optional.task.missing",
      dependencies: {
        maybeTask: task({
          id: "tests.optional.task",
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
    const t = task({
      id: "tests.optional.present.task",
      async run() {
        return "result" as const;
      },
    });

    const registrar = resource({
      id: "tests.optional.task.registrar",
      register: [t],
      async init() {
        return "ready" as const;
      },
    });

    const app = resource({
      id: "tests.optional.task.user",
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
    const res = resource({ id: "tests.optional.resource" });

    const app = resource({
      id: "tests.optional.resource.user",
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
    const res = resource({
      id: "tests.optional.resource.present",
      async init() {
        return 42 as const;
      },
    });

    const registrar = resource({
      id: "tests.optional.resource.registrar",
      register: [res],
      async init() {
        return "ready" as const;
      },
    });

    const app = resource({
      id: "tests.optional.resource.user2",
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

  test("global middleware exclusion detects optional-wrapped dependency on target task", async () => {
    const target = task({
      id: "tests.optional.middleware.target",
      async run() {
        return "x" as const;
      },
    });

    const mw = defineTaskMiddleware({
      id: "tests.optional.middleware",
      everywhere(resource) {
        return resource.id !== target.id;
      },
      dependencies: {
        target: target.optional(),
      },
      async run({ next }) {
        return next();
      },
    });

    const app = resource({
      id: "tests.optional.middleware.app",
      register: [target, mw],
      async init() {
        // Running the task should not apply the middleware because it depends on the same task
        const harness = resource({
          id: "tests.optional.middleware.harness",
          register: [target],
        });
        const rr = await run(harness);
        const out = await rr.runTask(target);
        expect(out).toBe("x");
        return "ready" as const;
      },
    });

    const { value } = await run(app);
    expect(value).toBe("ready");
  });

  test("event.optional() missing should resolve to undefined", async () => {
    const ev = event({ id: "tests.optional.event.missing" });
    const app = resource({
      id: "tests.optional.event.user",
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
    const ev = event<{ v: number }>({ id: "tests.optional.event.present" });
    const registrar = resource({
      id: "tests.optional.event.registrar",
      register: [ev],
      async init() {
        return "rdy" as const;
      },
    });
    const app = resource({
      id: "tests.optional.event.user2",
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

    const app = resource({
      id: "tests.optional.invalid",
      dependencies: {
        // @ts-expect-error
        bad: badWrapper,
      },
      async init() {
        return "never";
      },
    });

    await expect(run(app)).rejects.toThrow();
  });

  test("getDependentNodes accounts for optional deps in tasks and resources", async () => {
    const depTask = task({
      id: "tests.optional.graph.depTask",
      async run() {
        return "y" as const;
      },
    });
    const usesTask = task({
      id: "tests.optional.graph.usesTask",
      dependencies: { dep: depTask.optional() },
      async run() {
        return "x" as const;
      },
    });

    const depRes = resource({ id: "tests.optional.graph.depRes" });
    const usesRes = resource({
      id: "tests.optional.graph.usesRes",
      dependencies: { r: depRes.optional() },
      async init() {
        return "ok" as const;
      },
    });

    const app = resource({
      id: "tests.optional.graph.app",
      register: [depTask, usesTask, depRes, usesRes],
      async init() {
        return "ready" as const;
      },
    });
    const harness = resource({
      id: "tests.optional.graph.harness",
      register: [app],
    });
    const rr = await run(harness);
    // Indirectly exercise optional path in graph build by checking we can run tasks
    // (store internals no longer exposed via test harness)
    expect(typeof rr.runTask).toBe("function");
    // We still validate by running a no-op task without throwing
    await rr.runTask(usesTask);
  });

  it("task middleware should be able to depend on optional dependencies", async () => {
    const nonRegisteredResource = defineResource({
      id: "non.registered.resource",
      init: async () => true,
    });
    const nonRegisteredTask = defineTask({
      id: "non.registered.task",
      run: async () => "Task executed",
    });

    const registeredResource = defineResource({
      id: "registered.resource",
      init: async () => true,
    });
    const registeredTask = defineTask({
      id: "registered.task",
      run: async () => "Task executed",
    });

    const mw = defineTaskMiddleware({
      id: "everywhere.middleware",
      everywhere(task) {
        return ![registeredTask, nonRegisteredTask].some(
          (t) => t.id === task.id,
        );
      },
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
      id: "middlewarable.task",
      run: async (input: string) => input,
    });

    const app = defineResource({
      id: "app",
      register: [mw, registeredTask, registeredResource, middlewarableTask],
    });

    const r = await run(app);
    const result = await r.runTask(middlewarableTask, "Task executed");
    expect(result).toBe("Intercepted: Task executed");
  });

  it("resource middleware should be able to depend on optional dependencies", async () => {
    const nonRegisteredResource = defineResource({
      id: "non.registered.resource",
      init: async () => true,
    });
    const nonRegisteredTask = defineTask({
      id: "non.registered.task",
      run: async () => "Task executed",
    });

    const registeredResource = defineResource({
      id: "registered.resource",
      init: async () => true,
    });
    const registeredTask = defineTask({
      id: "registered.task",
      run: async () => "Task executed",
    });

    const mw = defineResourceMiddleware({
      id: "everywhere.middleware",
      everywhere(task) {
        return ![registeredResource, nonRegisteredResource].some(
          (t) => t.id === task.id,
        );
      },
      dependencies: {
        registeredResource,
        registeredTask,
        nonRegisteredResource: nonRegisteredResource.optional(),
        nonRegisteredTask: nonRegisteredTask.optional(),
      },
      run: async ({ next, resource: _resource }, deps) => {
        expect(deps.registeredResource).toBeDefined();
        expect(deps.registeredTask).toBeDefined();
        expect(deps.nonRegisteredResource).toBeUndefined();
        expect(deps.nonRegisteredTask).toBeUndefined();
        return "Intercepted: " + (await next());
      },
    });

    const middlewarableResource = defineResource({
      id: "middlewarable.resource",
      init: async () => "Hello",
    });

    const app = defineResource({
      id: "app",
      register: [mw, registeredTask, registeredResource, middlewarableResource],
    });

    const r = await run(app);
    const result = await r.getResourceValue(middlewarableResource);
    expect(result).toBe("Intercepted: Hello");
  });

  it("hooks should be able to depend on optional dependencies", async () => {
    const nonRegisteredResource = defineResource({
      id: "non.registered.resource",
      init: async () => true,
    });

    const registeredResource = defineResource({
      id: "registered.resource",
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
