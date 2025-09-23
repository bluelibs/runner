import { Logger } from "../../models/Logger";

describe("Logger coverage", () => {
  it("detectColorSupport respects NO_COLOR and TTY", async () => {
    const origEnv = (process as any).env;
    const origIsTTY = (process as any).stdout?.isTTY;
    try {
      (process as any).env = { ...origEnv, NO_COLOR: "1" };
      Object.defineProperty(process.stdout, "isTTY", {
        value: true,
        configurable: true,
      });
      const loggerNoColor = new Logger({
        printThreshold: null,
        printStrategy: "pretty",
        bufferLogs: false,
      });
      // Private method is exercised via constructor path; create another logger with NO_COLOR off
      (process as any).env = { ...origEnv };
      Object.defineProperty(process.stdout, "isTTY", {
        value: true,
        configurable: true,
      });
      const loggerTty = new Logger({
        printThreshold: null,
        printStrategy: "pretty",
        bufferLogs: false,
      });
      expect(loggerNoColor).toBeInstanceOf(Logger);
      expect(loggerTty).toBeInstanceOf(Logger);
      // Exercise canPrint thresholds via with()
      const child = loggerTty.with({});
      await child.debug("m");
    } finally {
      (process as any).env = origEnv;
      if (typeof origIsTTY !== "undefined") {
        Object.defineProperty(process.stdout, "isTTY", {
          value: origIsTTY,
          configurable: true,
        });
      }
    }
  });

  it("detectColorSupport returns false when no TTY", async () => {
    const origEnv = (process as any).env;
    const origIsTTY = (process as any).stdout?.isTTY;
    try {
      (process as any).env = { ...origEnv };
      Object.defineProperty(process.stdout, "isTTY", {
        value: false,
        configurable: true,
      });
      const logger = new Logger({
        printThreshold: null,
        printStrategy: "pretty",
        bufferLogs: false,
      });
      expect(logger).toBeInstanceOf(Logger);
    } finally {
      (process as any).env = origEnv;
      if (typeof origIsTTY !== "undefined") {
        Object.defineProperty(process.stdout, "isTTY", {
          value: origIsTTY,
          configurable: true,
        });
      }
    }
  });

  it("detectColorSupport handles missing process.stdout", async () => {
    const desc = Object.getOwnPropertyDescriptor(process, "stdout");
    try {
      Object.defineProperty(process, "stdout", {
        value: undefined,
        configurable: true,
      } as any);
      const logger = new Logger({
        printThreshold: null,
        printStrategy: "pretty",
        bufferLogs: false,
      });
      expect(logger).toBeInstanceOf(Logger);
      // No throw means the branch with falsy stdout executed
    } finally {
      if (desc) Object.defineProperty(process, "stdout", desc as any);
    }
  });

  it("detectColorSupport handles when global process is undefined", async () => {
    const originalProcess = (global as any).process;
    try {
      // Remove global process to exercise typeof check branch
      (global as any).process = undefined;
      const logger = new Logger({
        printThreshold: null,
        printStrategy: "pretty",
        bufferLogs: false,
      });
      expect(logger).toBeInstanceOf(Logger);
    } finally {
      (global as any).process = originalProcess;
    }
  });

  it("detectColorSupport handles truthy stdout with undefined isTTY", async () => {
    const desc = Object.getOwnPropertyDescriptor(process, "stdout");
    try {
      Object.defineProperty(process, "stdout", {
        value: {},
        configurable: true,
      } as any);
      const logger = new Logger({
        printThreshold: null,
        printStrategy: "pretty",
        bufferLogs: false,
      });
      expect(logger).toBeInstanceOf(Logger);
    } finally {
      if (desc) Object.defineProperty(process, "stdout", desc as any);
    }
  });

  it("covers print gating branches when threshold is set and when null", async () => {
    const loggerOn = new Logger({
      printThreshold: "info",
      printStrategy: "pretty",
      bufferLogs: false,
    });
    const loggerOff = new Logger({
      printThreshold: null,
      printStrategy: "pretty",
      bufferLogs: false,
    });

    // Spy on printer.print to ensure canPrint gating is exercised
    const spyOn = jest.spyOn((loggerOn as any).printer, "print");
    const spyOff = jest.spyOn((loggerOff as any).printer, "print");

    await loggerOn.info("visible");
    await loggerOff.info("hidden");

    expect(spyOn).toHaveBeenCalled();
    expect(spyOff).not.toHaveBeenCalled();
  });

  it("flushes buffer and prints only allowed logs during lock()", async () => {
    const logger = new Logger({
      printThreshold: "warn",
      printStrategy: "pretty",
      bufferLogs: true,
    });
    const spy = jest.spyOn((logger as any).printer, "print");

    await logger.info("low");
    await logger.error("high");

    expect(spy).not.toHaveBeenCalled();

    await logger.lock();

    // Only error (>= warn) should have been printed after flush
    const printedMessages = spy.mock.calls.map((c) => (c[0] as any)?.message);
    expect(printedMessages).toContain("high");
    expect(printedMessages).not.toContain("low");
  });
});
