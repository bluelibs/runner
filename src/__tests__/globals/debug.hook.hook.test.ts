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
    } as any;

    const nonSystemEvent = { id: "tests.user.hookTriggered" } as any;

    await hookTriggeredListener.run(nonSystemEvent, {
      logger,
      debugConfig: "verbose",
    } as any);

    expect(
      infos.some((m) => m.includes("[hook] tests.user.hookTriggered triggered"))
    ).toBe(true);
  });

  it("logs for non-system event on hookCompleted when enabled", async () => {
    const infos: string[] = [];
    const logger = {
      info: async (msg: string) => {
        infos.push(String(msg));
      },
    } as any;

    const nonSystemEvent = { id: "tests.user.hookCompleted" } as any;

    await hookCompletedListener.run(nonSystemEvent, {
      logger,
      debugConfig: "verbose",
    } as any);

    expect(
      infos.some((m) => m.includes("[hook] tests.user.hookCompleted completed"))
    ).toBe(true);
  });
});
