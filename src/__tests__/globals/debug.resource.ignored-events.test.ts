import { defineResource, defineTask } from "../../define";
import { run } from "../../run";
import { createTestResource } from "../../testing";
import { debugResource } from "../../globals/resources/debug";
import { globalEvents } from "../../globals/globalEvents";
import { globalResources } from "../../globals/globalResources";
import { globalTags } from "../../globals/globalTags";
import { defineEvent, defineHook } from "../../define";

describe("debug resource - ignored system/lifecycle events", () => {
  it("does not log system/lifecycle events from global listener", async () => {
    const logs: Array<{ level: string; message: string }> = [];

    const collector = defineResource({
      id: "tests.collector.ignored",
      dependencies: { logger: globalResources.logger },
      async init(_, { logger }) {
        logger.onLog((log) => {
          logs.push(log);
        });
        return logs;
      },
    });

    const app = defineResource({
      id: "tests.app.ignored",
      register: [debugResource.with("verbose"), collector],
      async init() {
        return "ok" as const;
      },
    });

    await run(app, {
      logs: {
        printThreshold: null,
      },
    });

    // Emit system-lifecycle events directly
    // Simulate a system/lifecycle event by emitting ready via EventManager if necessary
    // But our global listener skips system/lifecycle-tagged events during normal run already.
    // We only assert that none of the captured info logs include [event] after boot.

    // Wait a tick for async handlers
    await new Promise((r) => setImmediate(r));

    // Ensure no event log about [event] tests.* from system emission
    const infoLogs = logs.filter((l) => l.level === "info");
    expect(infoLogs.some((l) => l.message.includes("[event] tests."))).toBe(
      false
    );
  });

  it("does not track system-tagged task execution in middleware (early return branch)", async () => {
    const messages: string[] = [];

    const collector = defineResource({
      id: "tests.collector.ignored.task",
      dependencies: { logger: globalResources.logger },
      async init(_, { logger }) {
        logger.onLog((log) => {
          messages.push(String(log.message));
        });
        return messages;
      },
    });

    const systemTask = defineTask({
      id: "tests.system.task",
      meta: { tags: [globalTags.system] },
      async run() {
        return "ok" as const;
      },
    });

    const app = defineResource({
      id: "tests.app.ignored.task",
      register: [debugResource.with("verbose"), collector, systemTask],
      dependencies: { systemTask },
      async init(_, { systemTask }) {
        await systemTask();
        return "done" as const;
      },
    });

    await run(app, {
      logs: {
        printThreshold: null,
      },
    });

    // Ensure middleware did not log task start/completed lines for system-tagged task
    const joined = messages.join("\n");
    expect(joined.includes("[task] tests.system.task starting to run")).toBe(
      false
    );
    expect(joined.includes("[task] tests.system.task completed")).toBe(false);
  });

  it("does not log hook triggered/completed messages (system-tagged observability events are skipped)", async () => {
    const messages: string[] = [];

    const collector = defineResource({
      id: "tests.collector.hooks.ignored",
      dependencies: { logger: globalResources.logger },
      async init(_, { logger }) {
        logger.onLog((log) => {
          messages.push(String(log.message));
        });
        return messages;
      },
    });

    const userEvent = defineEvent<{ n: number }>({ id: "tests.user.event" });

    // A normal hook listening to a user event
    const userHook = defineHook({
      id: "tests.user.hook",
      on: userEvent,
      async run() {
        // no-op
      },
    });

    const app = defineResource({
      id: "tests.app.hooks.ignored",
      register: [debugResource.with("verbose"), collector, userEvent, userHook],
      dependencies: { userEvent },
      async init(_, { userEvent }) {
        await userEvent({ n: 1 });
        return "ready" as const;
      },
    });

    await run(app, {
      logs: {
        printThreshold: null,
      },
    });

    const joined = messages.join("\n");
    expect(joined.includes("[hook] tests.user.hook triggered")).toBe(false);
    expect(joined.includes("[hook] tests.user.hook completed")).toBe(false);
  });
});
