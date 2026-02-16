import {
  defineEvent,
  defineResource,
  defineTask,
  defineTaskMiddleware,
} from "../../../define";
import { run } from "../../../run";
import { debugResource } from "../../../globals/resources/debug/debug.resource";

import { globalResources } from "../../../globals/globalResources";
import { debug } from "../../../globals/debug";
import { ILog } from "../../../models";

const { verbose: levelVerbose } = debug.levels;

Error.stackTraceLimit = Infinity;

describe("globals.resources.debug", () => {
  it("logs non-system events, non-lifecycle events via global event listener", async () => {
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
      async init() {
        return "done";
      },
    });

    const harness = defineResource({
      id: "tests.harness.events",
      register: [app],
    });
    const rr = await run(harness);

    await rr.runTask(emitter);

    const infoLogs = logs.filter((l) => l.level === "info");
    expect(
      infoLogs.some((l) => l.message.includes("Event tests.event emitted")),
    ).toBe(true);
  });

  it("tracks tasks and resources with middleware and logs around execution", async () => {
    const messages: string[] = [];

    const collector = defineResource({
      id: "tests.collector.middleware",
      dependencies: { logger: globalResources.logger },
      async init(_, { logger }) {
        logger.onLog((log) => {
          messages.push(log.message);
        });
        return messages;
      },
    });

    const localMiddleware = defineTaskMiddleware({
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
        return "done";
      },
    });

    const result = await run(app, {});
    await result.runTask(testTask);

    // Task/resource tracker messages (assert present during boot)
    expect(messages.some((m) => m.includes("Task tests.task is running"))).toBe(
      true,
    );
    expect(messages.some((m) => m.includes("Task tests.task completed"))).toBe(
      true,
    );
    // Middleware observability messages
    // Allow for either ordering due to interleaving; just assert presence
    const joined = messages.join("\n");
    expect(joined.includes("Middleware triggered for task tests.task")).toBe(
      true,
    );
    expect(joined.includes("Middleware completed for task tests.task")).toBe(
      true,
    );
    // Resource logs are implementation-defined depending on eager/lazy init.
    // We assert task tracking here.
  });

  it("auto-registers debug via run(options.debug) and logs events", async () => {
    const logs: Array<{ level: string; message: string }> = [];

    const collector = defineResource({
      id: "tests.collector.options.debug",
      dependencies: { logger: globalResources.logger },
      async init(_, { logger }) {
        logger.onLog((log) => {
          logs.push(log);
        });
        return logs;
      },
    });

    const testEvent = defineEvent<{ foo: string }>({
      id: "tests.event.options",
    });

    const emitter = defineTask({
      id: "tests.emitter.options",
      dependencies: { testEvent },
      async run(_input, { testEvent }) {
        await testEvent({ foo: "bar" });
        return "ok";
      },
    });

    const app = defineResource({
      id: "tests.app.options",
      register: [collector, testEvent, emitter],
      async init() {
        return "done";
      },
    });

    const harness = defineResource({
      id: "tests.harness.options",
      register: [app],
    });
    const rr = await run(harness, {
      debug: "verbose",
    });
    await rr.runTask(emitter);

    const infoLogs = logs
      .filter((l) => l.level === "info")
      .map((l) => String(l.message));
    expect(
      infoLogs.some((m) => m.includes("Event tests.event.options emitted")),
    ).toBe(true);
  });

  it("should ensure that the config of the resource is printted if the conig exists", async () => {
    const logs: ILog[] = [];
    const collector = defineResource({
      id: "tests.collector.options.debug",
      dependencies: { logger: globalResources.logger },
      async init(_, { logger }) {
        logger.onLog((log) => {
          logs.push(log);
        });
        return logs;
      },
    });

    const myResourceWithConfig = defineResource({
      id: "tests.resource.with.config",
      async init(c: { name: string }) {
        return c.name;
      },
    });

    const app = defineResource({
      id: "tests.app.options",
      register: [
        collector,
        debugResource.with("verbose"),
        myResourceWithConfig.with({ name: "test" }),
      ],
      async init() {
        return "done";
      },
    });

    await run(app);

    const resourceLogs = logs.filter((l) =>
      l.message.includes("Resource tests.resource.with.config"),
    );
    expect(resourceLogs).toHaveLength(2);
    expect(resourceLogs[0].data).toEqual({ config: { name: "test" } });
  });

  it("log the error when a task fails", async () => {
    const messages: string[] = [];

    const collector = defineResource({
      id: "tests.collector.locked",
      dependencies: { logger: globalResources.logger },
      async init(_, { logger }) {
        logger.onLog((log) => {
          messages.push(String(log.message));
        });
        return messages;
      },
    });

    const failingTask = defineTask({
      id: "tests.failing.task",
      async run() {
        throw new Error("boom");
      },
    });

    const simpleTask = defineTask({
      id: "tests.simple.task",
      async run() {
        return "ok";
      },
    });

    const app = defineResource({
      id: "tests.app.locked",
      register: [
        debugResource.with("verbose"),
        collector,
        failingTask,
        simpleTask,
      ],
      // Ensure collector initializes before app init (so it can subscribe before buffered logs flush)
      dependencies: { failingTask, collector },
      async init(_c, { failingTask }) {
        // Trigger error during init so middleware catch path is covered
        await expect(failingTask()).rejects.toThrow("boom");
        return "ready";
      },
    });

    const harness = defineResource({
      id: "tests.harness.locked",
      register: [app],
    });
    const rr = await run(harness);

    // After run completes, system is locked. Running a task now should not produce debug logs.
    const before = messages.length;
    await rr.runTask(simpleTask);
    const after = messages.length;

    // No new task start/completed messages should be added post-lock
    const newMessages = messages.slice(before, after).join("\n");
    expect(
      newMessages.includes("[task] tests.simple.task starting to run"),
    ).toBe(false);
    expect(newMessages.includes("[task] tests.simple.task completed")).toBe(
      false,
    );

    // Ensure error was logged during init
    expect(messages.some((m) => m.includes("Error: boom"))).toBe(true);
  });

  it("logs the error when a resource fails", async () => {
    const messages: string[] = [];

    const collector = defineResource({
      id: "tests.collector.resource.error",
      dependencies: { logger: globalResources.logger },
      async init(_, { logger }) {
        logger.onLog((log) => {
          messages.push(String(log.message));
        });
        return messages;
      },
    });

    const failingResource = defineResource({
      id: "tests.failing.resource",
      async init() {
        throw new Error("resource-bad");
      },
    });

    const app = defineResource({
      id: "tests.app.resource.error",
      register: [debugResource.with("verbose"), collector, failingResource],
      // Ensure collector is initialized before failing resource so it can subscribe to logs
      dependencies: { collector, failingResource },
      async init() {
        return "ready";
      },
    });

    await expect(run(app)).rejects.toThrow("resource-bad");

    // Ensure error was logged by the middleware's resource error path
    expect(messages.some((m) => m.includes("Error: resource-bad"))).toBe(true);
  });

  it("should work for when we don't print result, input, or error", async () => {
    const logs: Array<{ level: string; message: string }> = [];

    const collector = defineResource({
      id: "tests.collector.options.debug",
      dependencies: { logger: globalResources.logger },
      async init(_, { logger }) {
        logger.onLog((log) => {
          logs.push(log);
        });
        return logs;
      },
    });

    const testTask = defineTask({
      id: "tests.task",
      async run() {
        return "result";
      },
    });

    const app = defineResource({
      id: "tests.app.events",
      register: [debugResource.with("normal"), collector, testTask],
      async init() {
        return "done";
      },
    });

    const harness = defineResource({
      id: "tests.harness.events.simple",
      register: [app],
    });
    const rr = await run(harness);

    await rr.runTask(testTask);

    const messages = logs.map((l) => l.message);
    expect(messages.some((m) => m.includes(`Resource ${collector.id}`))).toBe(
      true,
    );
    expect(messages.some((m) => m.includes(`Resource ${harness.id}`))).toBe(
      true,
    );
  });

  it("omits task input/result, resource config/value, and event payload when flags are false", async () => {
    const logs: Array<{
      level: string;
      message: any;
      data?: Record<string, any> | undefined;
    }> = [];

    const collector = defineResource({
      id: "tests.collector.flags",
      dependencies: { logger: globalResources.logger },
      async init(_c: { value: string }, { logger }) {
        logger.onLog((log) => {
          logs.push({ level: log.level, message: log.message, data: log.data });
        });
        return logs;
      },
    });

    const testEvent = defineEvent<{ foo: string }>({ id: "tests.flags.event" });

    const testTask = defineTask({
      id: "tests.flags.task",
      dependencies: { testEvent },
      async run(_input: { name: string }, { testEvent }) {
        await testEvent({ foo: "bar" });
        return "result";
      },
    });

    // We skip asserting resource init logs to avoid eager/lazy init differences
    const config = {
      ...levelVerbose,
      logTaskInput: false,
      logTaskOutput: false,
      logResourceConfig: false,
      logResourceValue: false,
      logEventEmissionInput: false,
    } as const;

    const app = defineResource({
      id: "tests.app.flags",
      register: [collector.with({ value: "test" }), testEvent, testTask],
      dependencies: { testTask, collector },
      async init(_c, { testTask }) {
        return "done";
      },
    });

    const harness = defineResource({
      id: "tests.harness.flags",
      register: [app],
    });
    const rr = await run(harness, {
      logs: { bufferLogs: true },
      debug: config,
    });

    // Execute once more post-boot to ensure task logs captured
    await rr.runTask(testTask, { name: "test" });

    const messages = logs.map((l) => String(l.message));

    // Ensure the messages we're targeting exist
    expect(
      messages.some((m) => m.includes("Task tests.flags.task is running")),
    ).toBe(true);
    expect(
      messages.some((m) => m.includes("Task tests.flags.task completed")),
    ).toBe(true);
    expect(
      messages.some((m) => m.includes("Event tests.flags.event emitted")),
    ).toBe(true);

    // Now validate the attached data payloads are omitted according to flags
    const taskStart = logs.find((l) =>
      String(l.message).includes("Task tests.flags.task is running"),
    );
    expect(taskStart?.data).toBeUndefined();

    const taskComplete = logs.find((l) =>
      String(l.message).includes("Task tests.flags.task completed"),
    );
    expect(taskComplete?.data).toBeUndefined();

    const resourceStart = logs.find((l) =>
      String(l.message).includes(
        "Resource tests.flags.resource is initializing",
      ),
    );
    expect(resourceStart?.data).toBeUndefined();

    const resourceComplete = logs.find((l) =>
      String(l.message).includes("Resource tests.flags.resource initialized"),
    );
    expect(resourceComplete?.data).toBeUndefined();

    const eventLog = logs.find((l) =>
      String(l.message).includes("Event tests.flags.event emitted"),
    );
    expect(eventLog?.data).toBeUndefined();
  });
});
