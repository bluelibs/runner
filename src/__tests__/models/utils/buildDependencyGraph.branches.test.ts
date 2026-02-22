import {
  defineEvent,
  defineHook,
  defineResource,
  defineResourceMiddleware,
  defineTask,
  defineTaskMiddleware,
} from "../../../define";
import { run } from "../../../run";
import {
  buildDependencyGraph,
  buildEventEmissionGraph,
} from "../../../models/utils/buildDependencyGraph";

describe("buildDependencyGraph branch coverage", () => {
  it("handles tasks with no dependencies", async () => {
    const task = defineTask({
      id: "graph.branch.no-deps.task",
      run: async () => "ok",
    });

    const app = defineResource({
      id: "graph.branch.no-deps.app",
      register: [task],
    });

    const runtime = await run(app);
    await runtime.dispose();
  });

  it("handles task middleware with no dependencies", async () => {
    const mw = defineTaskMiddleware({
      id: "graph.branch.no-deps.task-mw",
      run: async ({ next, task }) => next(task.input),
    });

    const task = defineTask({
      id: "graph.branch.no-deps.task-mw.task",
      middleware: [mw],
      run: async () => "ok",
    });

    const app = defineResource({
      id: "graph.branch.no-deps.task-mw.app",
      register: [mw, task],
    });

    const runtime = await run(app);
    await runtime.dispose();
  });

  it("handles resource middleware with no dependencies", async () => {
    const mw = defineResourceMiddleware({
      id: "graph.branch.no-deps.resource-mw",
      run: async ({ next }) => next(),
    });

    const child = defineResource({
      id: "graph.branch.no-deps.resource-mw.child",
      middleware: [mw],
      init: async () => "ok",
    });

    const app = defineResource({
      id: "graph.branch.no-deps.resource-mw.app",
      register: [mw, child],
    });

    const runtime = await run(app);
    await runtime.dispose();
  });

  it("handles hooks with no dependencies", async () => {
    const event = defineEvent({ id: "graph.branch.no-deps.hook.event" });

    const hook = defineHook({
      id: "graph.branch.no-deps.hook",
      on: event,
      run: async () => undefined,
    });

    const app = defineResource({
      id: "graph.branch.no-deps.hook.app",
      register: [event, hook],
    });

    const runtime = await run(app);
    await runtime.dispose();
  });

  it("handles hooks listening to events without emitting events", async () => {
    const eventA = defineEvent({ id: "graph.branch.emission.a" });

    const hook = defineHook({
      id: "graph.branch.emission.hook",
      on: eventA,
      run: async () => undefined,
    });

    const app = defineResource({
      id: "graph.branch.emission.app",
      register: [eventA, hook],
    });

    const runtime = await run(app);
    await runtime.dispose();
  });

  it("covers defensive branches for missing dependencies and missing node lookups", () => {
    const eventA = defineEvent({ id: "graph.branch.defensive.event.a" });
    const eventB = defineEvent({ id: "graph.branch.defensive.event.b" });

    const fakeRegistry = {
      tasks: new Map([
        [
          "graph.branch.defensive.task",
          {
            task: {
              id: "graph.branch.defensive.task",
              dependencies: undefined,
              middleware: [{ id: "graph.branch.defensive.missing.task.mw" }],
            },
          },
        ],
      ]),
      taskMiddlewares: new Map([
        [
          "graph.branch.defensive.task.mw",
          {
            middleware: {
              id: "graph.branch.defensive.task.mw",
              dependencies: undefined,
            },
          },
        ],
      ]),
      resourceMiddlewares: new Map([
        [
          "graph.branch.defensive.resource.mw",
          {
            middleware: {
              id: "graph.branch.defensive.resource.mw",
              dependencies: undefined,
            },
          },
        ],
      ]),
      resources: new Map([
        [
          "graph.branch.defensive.resource",
          {
            resource: {
              id: "graph.branch.defensive.resource",
              dependencies: undefined,
              middleware: [
                { id: "graph.branch.defensive.missing.resource.mw" },
              ],
            },
          },
        ],
      ]),
      hooks: new Map([
        [
          "graph.branch.defensive.hook.no-deps",
          {
            hook: {
              id: "graph.branch.defensive.hook.no-deps",
              on: eventA,
              dependencies: undefined,
            },
          },
        ],
        [
          "graph.branch.defensive.hook.unknown-target",
          {
            hook: {
              id: "graph.branch.defensive.hook.unknown-target",
              on: eventA,
              dependencies: { eventB },
            },
          },
        ],
      ]),
      events: new Map([
        [
          eventA.id,
          {
            event: eventA,
          },
        ],
      ]),
      visibilityTracker: {
        isAccessible: () => true,
      },
    };

    expect(() =>
      buildDependencyGraph(
        fakeRegistry as unknown as Parameters<typeof buildDependencyGraph>[0],
      ),
    ).not.toThrow();

    const graph = buildEventEmissionGraph(
      fakeRegistry as unknown as Parameters<typeof buildEventEmissionGraph>[0],
    );
    expect(graph.find((node) => node.id === eventA.id)?.dependencies).toEqual(
      {},
    );
  });
});
