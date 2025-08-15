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
import { globalResources } from "../../globals/globalResources";

Error.stackTraceLimit = Infinity;

describe("globals.resources.debug", () => {
  it.only("logs non-system events, non-lifecycle events via global event listener", async () => {
    const logs: Array<{ level: string; message: string }> = [];

    const collector = defineResource({
      id: "tests.collector",
      dependencies: { logger: globalResources.logger },
      async init(_, { logger }) {
        logger.onLog((log) => {
          logs.push(log);
        });
        return logs;
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
      register: [debugResource.with("verbose"), collector, testEvent, emitter],
      dependencies: { emitter },
      async init(_, { emitter }) {
        await emitter();
        return "done";
      },
    });

    await run(app, {
      logs: {
        bufferLogs: false,
        printStrategy: "pretty",
        printThreshold: "debug",
      },
    });

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
        debugResource.with("verbose"),
        collector,
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

    await run(app, {
      logs: {
        bufferLogs: true,
      },
    });

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

  it.only("logs task and resource onError events", async () => {
    const captured: string[] = [];

    const collector = defineResource({
      id: "tests.collector.errors",
      async init() {
        return captured;
      },
    });

    const dummyTask = defineTask({
      id: "tests.failing.task",
      async run() {
        throw new Error("boom-task");
      },
    });
    const app = defineResource({
      id: "tests.app.errors",
      register: [debugResource.with("verbose"), collector, dummyTask],
      dependencies: { dummyTask },
      async init(_, { dummyTask }) {
        try {
          await dummyTask();
        } catch (error) {}
        return "ready";
      },
    });
    const harness = createTestResource(app);

    const { value: t } = await run(harness, {
      logs: {
        bufferLogs: true,
      },
    });

    const dummyResource = defineResource({
      id: "tests.failing.resource",
      async init() {
        return null as any;
      },
    });

    await t.eventManager.emit(
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
