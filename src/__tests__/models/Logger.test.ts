import { Logger, ILog, LogLevels } from "../../models/Logger";
import { EventManager } from "../../models/EventManager";
import { globalEvents } from "../../globalEvents";
import { mock } from "node:test";

describe("Logger", () => {
  let logger: Logger;
  let mockEventManager: jest.Mocked<EventManager>;

  beforeEach(() => {
    mockEventManager = new EventManager() as jest.Mocked<EventManager>;
    logger = new Logger(mockEventManager);
  });

  describe("log method", () => {
    it("should emit a log event with correct data", async () => {
      const testData = "Test log message";
      const testLevel = "info";
      mockEventManager.emit = jest.fn();

      await logger.log(testLevel, testData);

      expect(mockEventManager.emit).toHaveBeenCalledWith(
        globalEvents.log,
        expect.objectContaining({
          level: testLevel,
          data: testData,
          timestamp: expect.any(Date),
        })
      );
    });

    it("should handle different log levels", async () => {
      const levels: Array<LogLevels> = [
        "trace",
        "debug",
        "info",
        "warn",
        "error",
        "critical",
      ];

      mockEventManager.emit = jest.fn();

      for (const level of levels) {
        await logger.log(level, `Test ${level} message`);

        expect(mockEventManager.emit).toHaveBeenCalledWith(
          globalEvents.log,
          expect.objectContaining({
            level,
            data: `Test ${level} message`,
            timestamp: expect.any(Date),
          })
        );
      }
    });
  });

  describe("print method", () => {
    let consoleLogSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleLogSpy = jest.spyOn(console, "log").mockImplementation();
    });

    afterEach(() => {
      consoleLogSpy.mockRestore();
    });

    it("should print log messages correctly", async () => {
      const testLog: ILog = {
        level: "info",
        context: "test",
        data: "Test log message",
        timestamp: new Date("2023-01-01T00:00:00Z"),
      };

      await logger.print(testLog);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("[INFO] (test) - Test log message")
      );
    });

    it("should handle Error objects in log data", async () => {
      const testError = new Error("Test error");
      const testLog: ILog = {
        level: "error",
        data: testError,
        timestamp: new Date("2023-01-01T00:00:00Z"),
      };

      await logger.print(testLog);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Error: Error - Test error")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Stack Trace:")
      );
    });

    it("should pretty-print JSON objects in log data", async () => {
      const testObject = { key: "value", nested: { foo: "bar" } };
      const testLog: ILog = {
        level: "debug",
        data: testObject,
        timestamp: new Date("2023-01-01T00:00:00Z"),
      };

      await logger.print(testLog);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(JSON.stringify(testObject, null, 2))
      );
    });
  });

  describe("log level methods", () => {
    const testLevels: Array<LogLevels> = [
      "trace",
      "debug",
      "info",
      "warn",
      "error",
      "critical",
    ];

    for (const level of testLevels) {
      it(`should call log method with ${level} level`, async () => {
        const logSpy = jest.spyOn(logger, "log").mockImplementation();

        await logger[level]("Test log message");

        expect(logSpy).toHaveBeenCalledWith(
          level,
          "Test log message",
          undefined // the context parameter
        );
      });
    }
  });

  it("should auto-print logs based on autoPrintLogsAfter option", async () => {
    const autoPrintLevel: LogLevels = "warn";
    logger.setPrintThreshold(autoPrintLevel);
    const consoleLogSpy = jest.spyOn(console, "log").mockImplementation();

    const levels: Array<LogLevels> = [
      "trace",
      "debug",
      "info",
      "warn",
      "error",
      "critical",
    ];

    for (const level of levels) {
      logger.setPrintThreshold(level);
      await logger.log(level, `Test ${level} message`);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Test ${level} message`)
      );
    }

    // ensure events with a higher level thatn auto print level are printed, and lower levels are not
    logger.setPrintThreshold("error");
    await logger.log("info", "xx Test info message");
    await logger.log("error", "xx Test error message");

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("xx Test error message")
    );

    expect(consoleLogSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("xx Test info message")
    );

    consoleLogSpy.mockRestore();
  });
});
