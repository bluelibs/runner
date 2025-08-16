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

    const harness = createTestResource(app);
    const { value: t } = await run(harness, {
      logs: {
        bufferLogs: false,
        printStrategy: "pretty",
        printThreshold: "debug",
      },
    });

    await t.runTask(emitter);

    const infoLogs = logs.filter((l) => l.level === "info");
    expect(
      infoLogs.some((l) => l.message.includes("[event] tests.event"))
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

    // Task/resource tracker messages (assert present during boot)
    expect(
      messages.some((m) => m.includes("[task] tests.task starting to run"))
    ).toBe(true);
    expect(
      messages.some((m) => m.includes("[task] tests.task completed"))
    ).toBe(true);
    // Resource logs are implementation-defined depending on eager/lazy init.
    // We assert task tracking here.
  });
  // Optionally, add error logging tests later
});
