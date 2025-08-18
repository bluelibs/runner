import { Logger } from "../../models/Logger";
import {
  bindProcessErrorHandler,
  createDefaultUnhandledError,
  safeReportUnhandledError,
} from "../../models/UnhandledError";

describe("UnhandledError helpers", () => {
  const makeLogger = () =>
    new Logger({
      printThreshold: null,
      printStrategy: "pretty" as any,
      bufferLogs: false,
    });

  it("normalizes non-Error values and includes kind as data", async () => {
    const logger = makeLogger();
    const spy = jest.spyOn(logger, "error").mockResolvedValue();
    const handler = createDefaultUnhandledError(logger);
    await handler({ error: "boom", kind: "task", source: "x" });
    expect(spy).toHaveBeenCalledTimes(1);
    const args = spy.mock.calls[0];
    expect(args[0]).toBe("Error: boom");
    const info = args[1] as any;
    expect(info.source).toBe("x");
    expect(info.error).toBeInstanceOf(Error);
    expect(info.data).toEqual({ kind: "task" });
  });

  it("omits data when kind is undefined", async () => {
    const logger = makeLogger();
    const spy = jest.spyOn(logger, "error").mockResolvedValue();
    const handler = createDefaultUnhandledError(logger);
    await handler({ error: new Error("e") });
    const info = spy.mock.calls[0][1] as any;
    expect(info.data).toBeUndefined();
  });

  it("bindProcessErrorHandler forwards kind=process with source", async () => {
    const logger = makeLogger();
    const spy = jest.spyOn(logger, "error").mockResolvedValue();
    const base = createDefaultUnhandledError(logger);
    const wrapped = bindProcessErrorHandler(base);
    await wrapped(new Error("proc"), "uncaughtException");
    const info = spy.mock.calls[0][1] as any;
    expect(info.error).toBeInstanceOf(Error);
    expect(info.data).toEqual({ kind: "process" });
    expect(info.source).toBe("uncaughtException");
  });

  it("safeReportUnhandledError swallows handler errors", async () => {
    const noisy = jest.fn(async () => {
      throw new Error("handler failed");
    });
    await expect(
      safeReportUnhandledError(noisy, { error: new Error("x") }),
    ).resolves.toBeUndefined();
  });
});
