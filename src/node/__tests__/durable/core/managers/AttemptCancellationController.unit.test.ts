import { Logger } from "../../../../../models/Logger";
import { AttemptCancellationController } from "../../../../durable/core/managers/AttemptCancellationController";
import { MemoryStore } from "../../../../durable/store/MemoryStore";

function createLogger(): Logger {
  return new Logger({
    printThreshold: null,
    printStrategy: "pretty",
    bufferLogs: false,
  });
}

describe("durable: AttemptCancellationController live pause", () => {
  it("skips the live pause broadcast without an event bus", async () => {
    const controller = new AttemptCancellationController({
      store: new MemoryStore(),
      logger: createLogger(),
      liveCancellationEventBus: null,
    });

    await expect(
      controller.publishLivePauseRequested("e1", { reason: "operator pause" }),
    ).resolves.toBeUndefined();
  });
});
