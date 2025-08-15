import {
  defineEvent,
  defineMiddleware,
  defineResource,
  defineTask,
} from "../../define";
import { run } from "../../run";
import { globalEvents } from "../../globals/globalEvents";
import { debugResource } from "../../globals/resources/debug/debug.resource";
import { createTestResource } from "../../testing";

describe("globals.resources.debug", () => {
  it("logs non-system events via global event listener", async () => {
    const logs: Array<{ level: string; message: string }> = [];

    const collector = defineResource({
      id: "tests.collector",
      async init() {
        return logs;
      },
    });

    const onLog = defineTask({
      id: "tests.onLog",
      on: globalEvents.log,
      dependencies: { logs: collector },
      async run(event, { logs }) {
        logs.push({ level: event.data.level, message: event.data.message });
      },
    });

    const testEvent = defineEvent<{ foo: string }>({ id: "tests.event" });

    const emitter = defineTask({
      id: "tests.emitter",
      dependencies: { testEvent },
      async run(_input, { testEvent }) {
        await testEvent({ foo: "bar" });
        return "ok";
      },
    });

    const app = defineResource({
      id: "tests.app.events",
      register: [
        debugResource.with({ verbosity: "verbose" }),
        collector,
        onLog,
        testEvent,
        emitter,
      ],
      dependencies: { emitter },
      async init(_, { emitter }) {
        await emitter();
        return "done";
      },
    });

    await run(app);

    const infoLogs = logs.filter((l) => l.level === "info");
    expect(
      infoLogs.some((l) => l.message.includes("[event] tests.event"))
    ).toBe(true);
  });

  it("tracks tasks and resources with middleware and emits before/after middleware logs", async () => {
    const logs: string[] = [];

    const collector = defineResource({
      id: "tests.collector.middleware",
      async init() {
        return logs;
      },
    });

    const onLog = defineTask({
      id: "tests.onLog.middleware",
      on: globalEvents.log,
      dependencies: { logs: collector },
      async run(event, { logs }) {
        logs.push(`${event.data.level}:${event.data.message}`);
      },
    });

    const localMiddleware = defineMiddleware({
      id: "tests.local.middleware",
      async run({ next }) {
        return next();
      },
    });

    const testTask = defineTask({
      id: "tests.task",
      middleware: [localMiddleware],
      async run() {
        return "result";
      },
    });

    const subResource = defineResource({
      id: "tests.sub.resource",
      async init() {
        return "sub";
      },
    });

    const app = defineResource({
      id: "tests.app.middleware",
      register: [
        debugResource.with({ verbosity: "verbose" }),
        collector,
        onLog,
        localMiddleware,
        subResource,
        testTask,
      ],
      dependencies: { testTask, subResource },
      async init(_, { testTask }) {
        await testTask();
        return "done";
      },
    });

    await run(app);

    // Task/resource tracker messages
    expect(logs.some((m) => m.includes("[task] tests.task with input"))).toBe(
      true
    );
    expect(
      logs.some((m) => m.includes("[task] tests.task completed with result"))
    ).toBe(true);
    expect(
      logs.some((m) => m.includes("[resource] tests.sub.resource with config"))
    ).toBe(true);
    expect(
      logs.some((m) =>
        m.includes("[resource] tests.sub.resource initialized with result")
      )
    ).toBe(true);

    // Before/after middleware listener messages
    expect(
      logs.some((m) =>
        m.includes(
          "[middleware][task] tests.local.middleware starting wrapping tests.task"
        )
      )
    ).toBe(true);
    expect(
      logs.some((m) =>
        m.includes(
          "[middleware][task] tests.local.middleware finished wrapping tests.task"
        )
      )
    ).toBe(true);
  });

  it("logs task and resource onError events", async () => {
    const captured: string[] = [];

    const collector = defineResource({
      id: "tests.collector.errors",
      async init() {
        return captured;
      },
    });

    const onLog = defineTask({
      id: "tests.onLog.errors",
      on: globalEvents.log,
      dependencies: { captured: collector },
      async run(event, { captured }) {
        captured.push(`${event.data.level}:${event.data.message}`);
      },
    });

    const harness = createTestResource(
      defineResource({
        id: "tests.app.errors",
        register: [
          debugResource.with({ verbosity: "verbose" }),
          collector,
          onLog,
        ],
        async init() {
          return "ready";
        },
      })
    );

    const { value: facade } = await run(harness);

    const dummyTask = defineTask({ id: "tests.failing.task", async run() {} });
    const dummyResource = defineResource({
      id: "tests.failing.resource",
      async init() {
        return null as any;
      },
    });

    await facade.eventManager.emit(
      globalEvents.tasks.onError,
      {
        error: new Error("boom-task"),
        suppress: () => {},
        task: dummyTask,
      },
      dummyTask.id
    );

    await facade.eventManager.emit(
      globalEvents.resources.onError,
      {
        error: new Error("boom-resource"),
        suppress: () => {},
        resource: dummyResource,
      },
      dummyResource.id
    );

    // allow async logger emission
    await new Promise((r) => setImmediate(r));

    expect(
      captured.some(
        (m) =>
          m.includes("error:[task]") &&
          m.includes("errored out") &&
          m.includes("boom-task")
      )
    ).toBe(true);
    expect(
      captured.some(
        (m) =>
          m.includes("error:[resource]") &&
          m.includes("errored out") &&
          m.includes("boom-resource")
      )
    ).toBe(true);
  });
});
