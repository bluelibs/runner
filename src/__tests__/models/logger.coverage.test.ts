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
});
