import { defineEvent, defineHook, defineResource } from "../../define";
import { globalResources } from "../../globals/globalResources";
import { globalEventListener } from "../../globals/resources/debug";
import {
  hookTriggeredListener,
  hookCompletedListener,
} from "../../globals/resources/debug/hook.hook";
import { ILog } from "../../models";
import { run } from "../../run";

describe("globals.resources.debug.hook listeners", () => {
  it("Should log emission input when enabled", async () => {
    const event = defineEvent<{ value: string }>({
      id: "tests.user.event",
    });

    const hook = defineHook({
      id: "tests.user.hookTriggered",
      on: event,
      run: async (event, { logger, debugConfig }) => {
        // no-op
      },
    });

    const logs: ILog[] = [];
    const app = defineResource({
      id: "tests.user.app",
      register: [event, hook],
      dependencies: {
        logger: globalResources.logger,
      },
      init: async (_, { logger }) => {
        logger.onLog((log) => logs.push(log));
      },
    });

    const result = await run(app, {
      debug: {
        logEventEmissionOnRun: true,
        logEventEmissionInput: true,
      },
    });
    console.log(logs);
    await result.emitEvent(event, { value: "test" });
    const logsOfInterest = logs.filter(
      (log) => log.source === globalEventListener.id,
    );

    expect(logsOfInterest).toHaveLength(2);
    expect(logsOfInterest[1].message).toContain("test");
    expect(logsOfInterest[1].data).toEqual({ payload: { value: "test" } });
  });

  it("logs for non-system event on hookTriggered when enabled", async () => {
    const infos: string[] = [];
    const logger = {
      info: async (msg: string) => {
        infos.push(String(msg));
      },
    };

    const nonSystemEvent = { id: "tests.user.hookTriggered", data: {} };

    await hookTriggeredListener.run(nonSystemEvent as any, {
      logger: logger as any,
      debugConfig: "verbose" as any,
    });

    expect(
      infos.some((m) =>
        m.includes("Hook triggered for tests.user.hookTriggered"),
      ),
    ).toBe(true);
  });

  it("returns early when deps are missing (defensive)", async () => {
    await hookTriggeredListener.run(
      { id: "x", data: {} } as any,
      undefined as any,
    );
    await hookCompletedListener.run(
      { id: "y", data: {} } as any,
      undefined as any,
    );
  });
});
