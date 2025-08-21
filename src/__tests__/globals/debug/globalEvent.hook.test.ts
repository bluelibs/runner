import { defineEvent, defineResource, defineTask } from "../../../define";
import { run } from "../../../run";
import { globalResources } from "../../../globals/globalResources";
import { debugResource } from "../../../globals/resources/debug/debug.resource";
import { globalTags } from "../../../globals/globalTags";

describe("globals.resources.debug.globalEvent.hook", () => {
  it("logs non-system events and includes payload when configured (verbose)", async () => {
    const logs: Array<{ level: string; message: any; data?: any }> = [];

    const collector = defineResource({
      id: "tests.collector.global-event.verbose",
      dependencies: { logger: globalResources.logger },
      async init(_, { logger }) {
        logger.onLog((log) => {
          logs.push({ level: log.level, message: log.message, data: log.data });
        });
        return logs;
      },
    });

    const evt = defineEvent<{ foo: string }>({ id: "tests.global-event" });

    const emitter = defineTask({
      id: "tests.global-event.emitter",
      dependencies: { evt },
      async run(_input, { evt }) {
        await evt({ foo: "bar" });
        return "ok";
      },
    });

    const app = defineResource({
      id: "tests.app.global-event.verbose",
      register: [
        debugResource.with({
          logEventEmissionOnRun: true,
          logEventEmissionInput: true,
        }),
        collector,
        evt,
        emitter,
      ],
      // Ensure collector is initialized so it can subscribe to logs
      dependencies: { collector, emitter },
      async init() {
        return "ready";
      },
    });

    const rr = await run(app);
    await rr.runTask(emitter);

    const infoLogs = logs.filter((l) => l.level === "info");
    const eventLog = infoLogs.find((l) =>
      String(l.message).includes("Event tests.global-event emitted"),
    );

    expect(eventLog).toBeTruthy();
    expect(eventLog?.data).toEqual({ data: { foo: "bar" } });
  });

  it("omits event payload when logEventEmissionInput is false", async () => {
    const logs: Array<{ level: string; message: any; data?: any }> = [];

    const collector = defineResource({
      id: "tests.collector.global-event.flags",
      dependencies: { logger: globalResources.logger },
      async init(_, { logger }) {
        logger.onLog((log) => {
          logs.push({ level: log.level, message: log.message, data: log.data });
        });
        return logs;
      },
    });

    const evt = defineEvent<{ foo: string }>({
      id: "tests.global-event.flags",
    });

    const emitter = defineTask({
      id: "tests.global-event.flags.emitter",
      dependencies: { evt },
      async run(_input, { evt }) {
        await evt({ foo: "baz" });
        return "ok";
      },
    });

    const app = defineResource({
      id: "tests.app.global-event.flags",
      register: [collector, evt, emitter],
      dependencies: { collector, emitter },
      async init() {
        return "ready";
      },
    });

    const rr = await run(app, {
      // Auto-registers debug, but with payload logging disabled
      debug: { logEventEmissionOnRun: true, logEventEmissionInput: false },
      logs: { bufferLogs: true },
    });
    await rr.runTask(emitter);

    const infoLogs = logs.filter((l) => l.level === "info");
    const eventLog = infoLogs.find((l) =>
      String(l.message).includes("Event tests.global-event.flags emitted"),
    );

    expect(eventLog).toBeTruthy();
    expect(eventLog?.data).toBeUndefined();
  });

  it("does not log events tagged as system", async () => {
    const logs: Array<{ level: string; message: any }> = [];

    const collector = defineResource({
      id: "tests.collector.global-event.system",
      dependencies: { logger: globalResources.logger },
      async init(_, { logger }) {
        logger.onLog((log) => {
          logs.push({ level: log.level, message: log.message });
        });
        return logs;
      },
    });

    const systemEvt = defineEvent<{ sys: boolean }>({
      id: "tests.global-event.system",
      tags: [globalTags.system],
    });

    const emitter = defineTask({
      id: "tests.global-event.system.emitter",
      dependencies: { systemEvt },
      async run(_input, { systemEvt }) {
        await systemEvt({ sys: true });
        return "ok";
      },
    });

    const app = defineResource({
      id: "tests.app.global-event.system",
      register: [debugResource.with("verbose"), collector, systemEvt, emitter],
      async init() {
        return "ready";
      },
    });

    const rr = await run(app);
    await rr.runTask(emitter);

    const messages = logs.map((l) => String(l.message));
    expect(
      messages.some((m) =>
        m.includes("Event tests.global-event.system emitted"),
      ),
    ).toBe(false);
  });
});
