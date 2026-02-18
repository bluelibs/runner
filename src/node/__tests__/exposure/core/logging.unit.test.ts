import { Logger } from "../../../../models/Logger";
import { safeLogWarn } from "../../../exposure/logging";

function createLogger(): Logger {
  return new Logger({
    printThreshold: null,
    printStrategy: "pretty",
    bufferLogs: false,
  });
}

describe("node exposure logging", () => {
  it("safeLogWarn forwards message and data to logger.warn", () => {
    const logger = createLogger();
    const warnSpy = jest
      .spyOn(logger, "warn")
      .mockImplementation(async () => undefined);

    const data = { requestId: "r-1" };
    safeLogWarn(logger, "warn message", data);

    expect(warnSpy).toHaveBeenCalledWith("warn message", data);
  });

  it("safeLogWarn swallows synchronous logger failures", () => {
    const logger = createLogger();
    jest.spyOn(logger, "warn").mockImplementation(() => {
      throw new Error("logger failure");
    });

    expect(() => safeLogWarn(logger, "warn message", {})).not.toThrow();
  });
});
