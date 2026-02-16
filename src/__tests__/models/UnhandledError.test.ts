import { Logger, ILogInfo } from "../../models/Logger";
import {
  bindProcessErrorHandler,
  createDefaultUnhandledError,
  safeReportUnhandledError,
} from "../../models/UnhandledError";

describe("UnhandledError helpers", () => {
  const makeLogger = () =>
    new Logger({
      printThreshold: null,
      printStrategy: "pretty",
      bufferLogs: false,
    });

  it("normalizes non-Error values and includes kind in data", async () => {
    const logger = makeLogger();
    const spy = jest.spyOn(logger, "error").mockResolvedValue();
    const handler = createDefaultUnhandledError(logger);
    await handler({ error: "boom", kind: "task", source: "x" });
    expect(spy).toHaveBeenCalledTimes(1);
    const args = spy.mock.calls[0];
    expect(args[0]).toBe("Error: boom");
    const info = args[1] as ILogInfo;
    expect(info.source).toBe("x");
    expect(info.error).toBeInstanceOf(Error);
    // Logger may augment data (e.g., include the error); assert partial match
    expect(info.data).toMatchObject({ kind: "task" });
  });

  it("omits kind in data when kind is undefined", async () => {
    const logger = makeLogger();
    const spy = jest.spyOn(logger, "error").mockResolvedValue();
    const handler = createDefaultUnhandledError(logger);
    await handler({ error: new Error("e") });
    const info = spy.mock.calls[0][1] as ILogInfo;
    // Data may be present (logger may include error), but should not include kind
    expect(info.data?.kind).toBeUndefined();
  });

  it("bindProcessErrorHandler forwards kind=process with source", async () => {
    const logger = makeLogger();
    const spy = jest.spyOn(logger, "error").mockResolvedValue();
    const base = createDefaultUnhandledError(logger);
    const wrapped = bindProcessErrorHandler(base);
    await wrapped(new Error("proc"), "uncaughtException");
    const info = spy.mock.calls[0][1] as ILogInfo;
    expect(info.error).toBeInstanceOf(Error);
    // Allow extra fields in data; ensure kind is set correctly
    expect(info.data).toMatchObject({ kind: "process" });
    expect(info.source).toBe("uncaughtException");
  });

  it("safeReportUnhandledError swallows handler errors", async () => {
    const noisy = jest.fn(async () => {
      throw new Error("handler failed");
    });
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    await expect(
      safeReportUnhandledError(noisy, { error: new Error("x") }),
    ).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("bindProcessErrorHandler reports reporter failures to console.error", async () => {
    const reporter = jest.fn(async () => {
      throw new Error("reporter failed");
    });
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const wrapped = bindProcessErrorHandler(reporter);
    await expect(
      wrapped(new Error("proc"), "unhandledRejection"),
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalled();
  });

  it("safeReportUnhandledError reports reporter failures to console.error", async () => {
    const reporter = jest.fn(async () => {
      throw new Error("reporter failed");
    });
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(
      safeReportUnhandledError(reporter, { error: new Error("task") }),
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalled();
  });

  it("normalizes non-Error reporter/original values for fallback logging", async () => {
    const reporter = jest.fn(async () => {
      throw "reporter failed";
    });
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(
      safeReportUnhandledError(reporter, { error: "task failed" }),
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalled();
  });
});
