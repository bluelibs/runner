import {
  hookTriggeredListener,
  hookCompletedListener,
} from "../../globals/resources/debug/hook.hook";

describe("globals.resources.debug.hook listeners", () => {
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
        m.includes("[hook] tests.user.hookTriggered triggered"),
      ),
    ).toBe(true);
  });

  it("logs for non-system event on hookCompleted when enabled", async () => {
    const infos: string[] = [];
    const logger = {
      info: async (msg: string) => {
        infos.push(String(msg));
      },
    } as any;

    const nonSystemEvent = { id: "tests.user.hookCompleted", data: {} };

    await hookCompletedListener.run(nonSystemEvent as any, {
      logger: logger as any,
      debugConfig: "verbose" as any,
    });

    expect(
      infos.some((m) =>
        m.includes("[hook] tests.user.hookCompleted completed"),
      ),
    ).toBe(true);
  });

  it("does not log when hook flags disabled (triggered and completed)", async () => {
    const infos: string[] = [];
    const logger = {
      info: async (msg: string) => {
        infos.push(String(msg));
      },
    } as any;

    const nonSystemEvent = { id: "tests.user.hookCompleted.flags", data: {} };

    await hookCompletedListener.run(nonSystemEvent as any, {
      logger: logger as any,
      debugConfig: { logHookCompleted: false } as any,
    });

    expect(
      infos.some((m) =>
        m.includes("[hook] tests.user.hookCompleted.flags completed"),
      ),
    ).toBe(false);

    await hookTriggeredListener.run(
      { id: "tests.user.hookTriggered.flags", data: {} } as any,
      {
        logger: logger as any,
        debugConfig: { logHookTriggered: false } as any,
      },
    );
    expect(
      infos.some((m) =>
        m.includes("[hook] tests.user.hookTriggered.flags triggered"),
      ),
    ).toBe(false);
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
