import { Logger } from "../../../models/Logger";
import { allFalse } from "../../../globals/resources/debug/types";
import { globalTags } from "../../../globals/globalTags";
import { globalEventListener } from "../../../globals/resources/debug/globalEvent.hook";
import { runtimeSource } from "../../../types/runtimeSource";

type GlobalEventRun = NonNullable<typeof globalEventListener.run>;
type GlobalEventRunDeps = Parameters<GlobalEventRun>[1];
type GlobalEventRunInput = Parameters<GlobalEventRun>[0];

function createEvent(
  id: string,
  tags: GlobalEventRunInput["tags"] = [],
): GlobalEventRunInput {
  let propagationStopped = false;
  return {
    id,
    data: undefined,
    timestamp: new Date(),
    source: runtimeSource.runtime("tests"),
    meta: {},
    stopPropagation() {
      propagationStopped = true;
    },
    isPropagationStopped() {
      return propagationStopped;
    },
    tags,
  };
}

describe("globals.resources.debug.globalEventListener (unit)", () => {
  it("does not log when emission logging is disabled", async () => {
    const messages: string[] = [];
    const logger = new Logger({
      printThreshold: null,
      printStrategy: "pretty",
      bufferLogs: false,
    });
    jest.spyOn(logger, "info").mockImplementation(async (message: unknown) => {
      messages.push(String(message));
    });
    const deps = {
      logger,
      debugConfig: { ...allFalse, logEventEmissionOnRun: false },
    } satisfies GlobalEventRunDeps;

    await globalEventListener.run?.(createEvent("tests.event.no-log"), deps);

    expect(messages).toEqual([]);
  });

  it("returns early for system-tagged events", async () => {
    const messages: string[] = [];
    const logger = new Logger({
      printThreshold: null,
      printStrategy: "pretty",
      bufferLogs: false,
    });
    jest.spyOn(logger, "info").mockImplementation(async (message: unknown) => {
      messages.push(String(message));
    });
    const deps = {
      logger,
      debugConfig: { ...allFalse, logEventEmissionOnRun: true },
    } satisfies GlobalEventRunDeps;

    await globalEventListener.run?.(
      createEvent("tests.event.system", [globalTags.system]),
      deps,
    );

    expect(messages).toEqual([]);
  });
});
