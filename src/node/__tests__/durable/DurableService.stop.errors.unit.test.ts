import { DurableService } from "../../durable/core/DurableService";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { genericError } from "../../../errors";
import { Logger } from "../../../models/Logger";

describe("durable: DurableService stop errors", () => {
  it("logs polling shutdown failures before rethrowing them", async () => {
    const store = new MemoryStore();
    const logger = new Logger({
      printThreshold: null,
      printStrategy: "pretty",
      bufferLogs: false,
    });
    const service = new DurableService({ store, tasks: [], logger });
    const pollingError = genericError.new({ message: "polling-stop-failed" });
    const loggerError = jest
      .spyOn((service as unknown as { logger: Logger }).logger, "error")
      .mockResolvedValue();

    (
      service as unknown as {
        pollingManager: { stop: () => Promise<void> };
      }
    ).pollingManager.stop = jest.fn(async () => {
      throw pollingError;
    });

    await expect(service.stop()).rejects.toThrow("polling-stop-failed");
    expect(loggerError).toHaveBeenCalledWith(
      "Durable polling shutdown failed.",
      { error: pollingError },
    );
  });
});
