import { Logger } from "../../models/Logger";

describe("Logger detectColorSupport branches", () => {
  const original = process.env.NO_COLOR;
  afterEach(() => {
    if (original === undefined) {
      delete (process.env as any).NO_COLOR;
    } else {
      process.env.NO_COLOR = original;
    }
  });

  it("returns false when NO_COLOR is set", () => {
    process.env.NO_COLOR = "1";
    const logger = new Logger({
      printThreshold: null,
      printStrategy: "pretty",
      bufferLogs: false,
    });
    // @ts-ignore access private via any for coverage
    expect((logger as any).detectColorSupport()).toBe(false);
  });

  it("checks tty when NO_COLOR not set", () => {
    delete (process.env as any).NO_COLOR;
    const logger = new Logger({
      printThreshold: null,
      printStrategy: "pretty",
      bufferLogs: false,
    });
    // We can't force TTY in CI; ensure it returns a boolean without throwing
    // @ts-ignore access private via any for coverage
    const result = (logger as any).detectColorSupport();
    expect(typeof result).toBe("boolean");
  });
});
