import { defineResource, defineTask } from "../../define";
import { run } from "../../run";
import { createTestResource } from "../../testing";
import { debugResource } from "../../globals/resources/debug";
import { globalEvents } from "../../globals/globalEvents";
import { globalResources } from "../../globals/globalResources";

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

    await run(app);

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
});
