import { globalTags } from "../../../globals/globalTags";
import { globalEventListener } from "../../../globals/resources/debug/globalEvent.hook";

describe("globals.resources.debug.globalEventListener (unit)", () => {
  it("does not log when emission logging is disabled", async () => {
    const messages: string[] = [];
    const logger = {
      info: async (message: string) => {
        messages.push(message);
      },
    };

    await globalEventListener.run?.(
      { id: "tests.event.no-log" } as never,
      {
        logger,
        debugConfig: { logEventEmissionOnRun: false },
      } as never,
    );

    expect(messages).toEqual([]);
  });

  it("returns early for system-tagged events", async () => {
    const messages: string[] = [];
    const logger = {
      info: async (message: string) => {
        messages.push(message);
      },
    };

    await globalEventListener.run?.(
      { id: "tests.event.system", tags: [globalTags.system] } as never,
      {
        logger,
        debugConfig: { logEventEmissionOnRun: true },
      } as never,
    );

    expect(messages).toEqual([]);
  });
});
