import { Logger, ILog, LogLevels } from "../../models/Logger";
import { EventManager } from "../../models/EventManager";
import { globalEvents } from "../../globals/globalEvents";

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
      mockEventManager.emit = jest.fn().mockResolvedValue(undefined);
      mockEventManager.hasListeners = jest.fn().mockReturnValue(true);

      logger.log(testLevel, testData);

      // Wait for setImmediate to execute
      await new Promise(setImmediate);

      expect(mockEventManager.emit).toHaveBeenCalledWith(
        globalEvents.log,
        expect.objectContaining({
          level: testLevel,
          message: testData,
          timestamp: expect.any(Date),
        }),
        "unknown"
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

      mockEventManager.emit = jest.fn().mockResolvedValue(undefined);
      mockEventManager.hasListeners = jest.fn().mockReturnValue(true);

      for (const level of levels) {
        logger.log(level, `Test ${level} message`, { source: "testSource" });
      }

      // Wait for setImmediate to execute
      await new Promise(setImmediate);

      // Check all calls were made
      expect(mockEventManager.emit).toHaveBeenCalledTimes(levels.length);
    });

    it("should not emit events when there are no listeners", () => {
      mockEventManager.emit = jest.fn().mockResolvedValue(undefined);
      mockEventManager.hasListeners = jest.fn().mockReturnValue(false);

      logger.log("info", "Test message");

      // Should not emit events when no listeners
      expect(mockEventManager.emit).not.toHaveBeenCalled();
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
        source: "test",
        message: "Test log message",
        timestamp: new Date("2023-01-01T00:00:00Z"),
      };

      await logger.print(testLog);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("INFO")
      );
    });

    it("should handle Error objects in log data", () => {
      const testError = new Error("Test error");
      const testLog: ILog = {
        level: "error",
        message: "Operation failed",
        error: {
          name: testError.name,
          message: testError.message,
          stack: testError.stack,
        },
        timestamp: new Date("2023-01-01T00:00:00Z"),
      };

      logger.print(testLog);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("ERROR")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Error: Error")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Test error")
      );
    });

    it("should handle error objects without stack trace", () => {
      const testLog: ILog = {
        level: "error",
        message: "Operation failed",
        error: {
          name: "CustomError",
          message: "Something went wrong",
        },
        timestamp: new Date("2023-01-01T00:00:00Z"),
      };

      logger.print(testLog);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("ERROR")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Error: CustomError")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Something went wrong")
      );
    });

    it("should pretty-print structured data", () => {
      const testObject = { key: "value", nested: { foo: "bar" } };
      const testLog: ILog = {
        level: "debug",
        message: "Debug info",
        data: testObject,
        timestamp: new Date("2023-01-01T00:00:00Z"),
      };

      logger.print(testLog);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("DEBUG")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('"key": "value"')
      );
    });

    it("should handle object message by stringifying it", () => {
      const objectMessage = { type: "user", action: "login" };
      const testLog: ILog = {
        level: "info",
        message: objectMessage as any,
        timestamp: new Date("2023-01-01T00:00:00Z"),
      };

      logger.print(testLog);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("INFO")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(JSON.stringify(objectMessage, null, 2))
      );
    });

    it("should print context information when present", () => {
      const context = { userId: "123", requestId: "abc-def" };
      const testLog: ILog = {
        level: "warn",
        message: "Warning message",
        data: context,
        timestamp: new Date("2023-01-01T00:00:00Z"),
      };

      logger.print(testLog);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("WARN")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('"userId": "123"')
      );
    });

    it("should print context from context field", () => {
      const context = { userId: "456", feature: "login", source: "auth" };
      const testLog: ILog = {
        level: "info",
        message: "User action",
        context: context,
        timestamp: new Date("2023-01-01T00:00:00Z"),
      };

      logger.print(testLog);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("INFO")
      );
      // Should show context but filter out 'source' since it's shown separately
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Context:")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('"userId": "456"')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('"feature": "login"')
      );
    });

    it("should handle empty context gracefully", () => {
      const testLog: ILog = {
        level: "debug",
        message: "Debug message",
        context: {},
        timestamp: new Date("2023-01-01T00:00:00Z"),
      };

      logger.print(testLog);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("DEBUG")
      );
      // Should not print context section for empty context
      expect(consoleLogSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("Context:")
      );
    });

    it("should handle unknown log levels gracefully", () => {
      const testLog: ILog = {
        level: "unknown" as any,
        message: "Unknown level message",
        timestamp: new Date("2023-01-01T00:00:00Z"),
      };

      logger.print(testLog);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("UNKNOWN")
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
      it(`should call log method with ${level} level`, () => {
        const logSpy = jest.spyOn(logger, "log").mockImplementation();

        logger[level]("Test log message");

        expect(logSpy).toHaveBeenCalledWith(
          level,
          "Test log message",
          {} // the LogInfo parameter
        );
      });
    }
  });

  describe("with method", () => {
    it("should create a new logger with additional context", () => {
      const initialContext = { source: "initial" };
      const loggerWithContext = new Logger(mockEventManager, initialContext);

      const additionalContext = { userId: "123", feature: "auth" };
      const newLogger = loggerWithContext.with(additionalContext);

      expect(newLogger).toBeInstanceOf(Logger);
      expect(newLogger).not.toBe(loggerWithContext);

      // Test that the context is merged by checking the log call
      const logSpy = jest.spyOn(newLogger, "log").mockImplementation();
      newLogger.info("test message");

      expect(logSpy).toHaveBeenCalledWith("info", "test message", {});
    });

    it("should override context values when keys overlap", () => {
      const initialContext = { source: "initial", common: "old" };
      const loggerWithContext = new Logger(mockEventManager, initialContext);

      const newContext = { source: "override", newProp: "value" };
      const newLogger = loggerWithContext.with(newContext);

      // The new logger should have the overridden context
      expect(newLogger).toBeInstanceOf(Logger);
    });

    it("should use bound context in log calls", async () => {
      const boundContext = { source: "testSource", userId: "123" };
      const loggerWithContext = new Logger(mockEventManager, boundContext);

      mockEventManager.emit = jest.fn().mockResolvedValue(undefined);
      mockEventManager.hasListeners = jest.fn().mockReturnValue(true);

      loggerWithContext.log("info", "Test message");

      await new Promise(setImmediate);

      expect(mockEventManager.emit).toHaveBeenCalledWith(
        globalEvents.log,
        expect.objectContaining({
          source: "testSource",
          context: boundContext,
        }),
        "testSource"
      );
    });
  });

  describe("error handling", () => {
    it("should handle event emission errors gracefully", async () => {
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
      const emitError = new Error("Event emission failed");

      mockEventManager.emit = jest.fn().mockRejectedValue(emitError);
      mockEventManager.hasListeners = jest.fn().mockReturnValue(true);

      logger.log("error", "Test error message");

      // Wait for setImmediate and promise rejection to be handled
      await new Promise(setImmediate);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Logger event emission failed:",
        emitError
      );

      consoleErrorSpy.mockRestore();
    });

    it("should extract error information from Error objects", async () => {
      mockEventManager.emit = jest.fn().mockResolvedValue(undefined);
      mockEventManager.hasListeners = jest.fn().mockReturnValue(true);

      const testError = new Error("Test error message");
      testError.name = "CustomError";

      logger.log("error", "Operation failed", { error: testError });

      // Wait for setImmediate to execute
      await new Promise(setImmediate);

      expect(mockEventManager.emit).toHaveBeenCalledWith(
        globalEvents.log,
        expect.objectContaining({
          level: "error",
          message: "Operation failed",
          error: {
            name: "CustomError",
            message: "Test error message",
            stack: expect.any(String),
          },
          timestamp: expect.any(Date),
        }),
        "unknown"
      );
    });
  });

  it("should auto-print logs based on autoPrintLogsAfter option", () => {
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
      logger.log(level, `Test ${level} message`);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Test ${level} message`)
      );
    }

    // ensure events with a higher level thatn auto print level are printed, and lower levels are not
    logger.setPrintThreshold("error");
    logger.log("info", "xx Test info message");
    logger.log("error", "xx Test error message");

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("xx Test error message")
    );

    expect(consoleLogSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("xx Test info message")
    );

    consoleLogSpy.mockRestore();
  });

  it("should disable auto-printing when setPrintThreshold is set to null", () => {
    const consoleLogSpy = jest.spyOn(console, "log").mockImplementation();

    // Set to null to disable auto-printing
    logger.setPrintThreshold(null);

    logger.log("error", "Should not be printed");

    expect(consoleLogSpy).not.toHaveBeenCalled();

    consoleLogSpy.mockRestore();
  });
});
